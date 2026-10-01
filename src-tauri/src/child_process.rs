//! Own a CLI process tree and poll its pipes without waiting for EOF.
use std::{
    io::{self, Read},
    ops::{Deref, DerefMut},
    process::{ChildStderr, ChildStdout, Command},
    sync::Mutex,
};

/// The job remains alive after the direct child exits, so closing it also
/// terminates descendants that inherited stdout or stderr.
pub struct Child {
    inner: std::process::Child,
    #[cfg(windows)]
    job: Option<std::os::windows::io::OwnedHandle>,
}
impl Child {
    pub fn spawn(command: &mut Command) -> io::Result<Self> {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use windows::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};
            // Hold the primary thread until its job is assigned. Even a fast
            // shim cannot exit or spawn unowned descendants in this window.
            command.creation_flags(CREATE_NO_WINDOW.0 | CREATE_SUSPENDED.0);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let inner = command.spawn()?;
        let mut child = Self {
            inner,
            #[cfg(windows)]
            job: None,
        };
        #[cfg(windows)]
        {
            use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
            use windows::Win32::{
                Foundation::HANDLE,
                System::JobObjects::{
                    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                },
            };
            // SAFETY: both handles are owned and live throughout these calls.
            // The job handle is not inherited by children and is closed once.
            let job = unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null()) }
                .map_err(io::Error::other)?;
            let job = unsafe { OwnedHandle::from_raw_handle(job.0) };
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            unsafe {
                SetInformationJobObject(
                    HANDLE(job.as_raw_handle()),
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of_val(&limits) as u32,
                )
                .map_err(io::Error::other)?;
                AssignProcessToJobObject(
                    HANDLE(job.as_raw_handle()),
                    HANDLE(child.inner.as_raw_handle()),
                )
                .map_err(io::Error::other)?;
            }
            child.job = Some(job);
            resume_initial_thread(child.inner.id())?;
        }
        Ok(child)
    }
}

#[cfg(windows)]
fn resume_initial_thread(pid: u32) -> io::Result<()> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows::Win32::{
        Foundation::{FILETIME, HANDLE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD,
                THREADENTRY32,
            },
            Threading::{
                GetThreadTimes, OpenThread, ResumeThread, THREAD_QUERY_LIMITED_INFORMATION,
                THREAD_SUSPEND_RESUME,
            },
        },
    };
    // std::process does not expose the primary thread handle on stable Rust.
    // Select the earliest-created thread belonging to this suspended child;
    // injected helper threads must not be resumed in its place.
    let snapshot =
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) }.map_err(io::Error::other)?;
    let snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot.0) };
    let mut entry = THREADENTRY32 {
        dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    let mut primary: Option<(u64, OwnedHandle)> = None;
    unsafe { Thread32First(HANDLE(snapshot.as_raw_handle()), &mut entry) }
        .map_err(io::Error::other)?;
    loop {
        if entry.th32OwnerProcessID == pid {
            let thread = unsafe {
                OpenThread(
                    THREAD_QUERY_LIMITED_INFORMATION | THREAD_SUSPEND_RESUME,
                    false,
                    entry.th32ThreadID,
                )
            }
            .map_err(io::Error::other)?;
            let thread = unsafe { OwnedHandle::from_raw_handle(thread.0) };
            let (mut created, mut exited, mut kernel, mut user) = (
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
            );
            unsafe {
                GetThreadTimes(
                    HANDLE(thread.as_raw_handle()),
                    &mut created,
                    &mut exited,
                    &mut kernel,
                    &mut user,
                )
            }
            .map_err(io::Error::other)?;
            let time = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
            if primary
                .as_ref()
                .is_none_or(|(earliest, _)| time < *earliest)
            {
                primary = Some((time, thread));
            }
        }
        if unsafe { Thread32Next(HANDLE(snapshot.as_raw_handle()), &mut entry) }.is_err() {
            break;
        }
    }
    let (_, thread) =
        primary.ok_or_else(|| io::Error::other("CLI primary thread was not found"))?;
    // SAFETY: the handle belongs to the child we created suspended and the
    // job is already assigned. Release only our one initial suspension.
    match unsafe { ResumeThread(HANDLE(thread.as_raw_handle())) } {
        u32::MAX => Err(io::Error::last_os_error()),
        1 => Ok(()),
        0 => Err(io::Error::other("CLI primary thread was not suspended")),
        _ => Err(io::Error::other("CLI primary thread remained suspended")),
    }
}
impl Deref for Child {
    type Target = std::process::Child;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}
impl DerefMut for Child {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}
impl Drop for Child {
    fn drop(&mut self) {
        #[cfg(windows)]
        if let Some(job) = self.job.take() {
            drop(job);
        } else if self.inner.try_wait().ok().flatten().is_none() {
            // Covers a spawn that failed before it could join its job.
            crate::runner::terminate_tree(self.inner.id());
        }
        #[cfg(unix)]
        unsafe {
            // SAFETY: spawn gave this child its own process group.
            libc::kill(-(self.inner.id() as i32), libc::SIGKILL);
        }
        if self.inner.try_wait().ok().flatten().is_none() {
            let _ = self.inner.kill();
        }
        let _ = self.inner.wait();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Running,
    Exited(Option<i32>),
    Stopped,
}

/// Each turn gets a separate handle. Stopping an old handle cannot stop a
/// newer child registered under the same conversation.
pub struct SharedChild(Mutex<Option<Child>>);
impl SharedChild {
    pub fn new(child: Child) -> Self {
        Self(Mutex::new(Some(child)))
    }
    pub fn status(&self) -> io::Result<Status> {
        let mut guard = self
            .0
            .lock()
            .map_err(|_| io::Error::other("Child state unavailable"))?;
        match guard.as_mut() {
            Some(child) => Ok(match child.try_wait()? {
                Some(status) => Status::Exited(status.code()),
                None => Status::Running,
            }),
            None => Ok(Status::Stopped),
        }
    }
    pub fn stop(&self) {
        let child = self.0.lock().ok().and_then(|mut child| child.take());
        drop(child);
    }
}

#[cfg(windows)]
trait PipeHandle: std::os::windows::io::AsRawHandle {}
#[cfg(windows)]
impl<T: std::os::windows::io::AsRawHandle> PipeHandle for T {}
#[cfg(unix)]
trait PipeHandle: std::os::unix::io::AsRawFd {}
#[cfg(unix)]
impl<T: std::os::unix::io::AsRawFd> PipeHandle for T {}

struct Pipe<R> {
    reader: R,
    partial: Vec<u8>,
    closed: bool,
    lossy: bool,
}
impl<R: Read + PipeHandle> Pipe<R> {
    fn new(reader: R, lossy: bool) -> io::Result<Self> {
        #[cfg(unix)]
        unsafe {
            // SAFETY: the descriptor belongs to reader and remains live here.
            let flags = libc::fcntl(reader.as_raw_fd(), libc::F_GETFL);
            if flags < 0
                || libc::fcntl(reader.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) < 0
            {
                return Err(io::Error::last_os_error());
            }
        }
        Ok(Self {
            reader,
            partial: Vec::new(),
            closed: false,
            lossy,
        })
    }
    fn read_ready(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        #[cfg(windows)]
        {
            use windows::Win32::{
                Foundation::{ERROR_BROKEN_PIPE, ERROR_NO_DATA, HANDLE},
                System::Pipes::PeekNamedPipe,
            };
            let mut available = 0;
            // Only this supervisor reads the handle, so no concurrent read
            // can consume these bytes between the peek and the read.
            if let Err(error) = unsafe {
                PeekNamedPipe(
                    HANDLE(self.reader.as_raw_handle()),
                    None,
                    0,
                    None,
                    Some(&mut available),
                    None,
                )
            } {
                if error.code() == windows::core::HRESULT::from_win32(ERROR_BROKEN_PIPE.0)
                    || error.code() == windows::core::HRESULT::from_win32(ERROR_NO_DATA.0)
                {
                    return Ok(0);
                }
                return Err(io::Error::other(error));
            }
            if available == 0 {
                return Err(io::ErrorKind::WouldBlock.into());
            }
            let length = buffer.len().min(available as usize);
            self.reader.read(&mut buffer[..length])
        }
        #[cfg(unix)]
        self.reader.read(buffer)
    }
    fn line(&mut self, terminated: bool) -> io::Result<String> {
        let mut bytes = std::mem::take(&mut self.partial);
        if terminated && bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
        if self.lossy {
            // Windows shell diagnostics may use the active code page. Their
            // encoding must not discard a valid completion on stdout.
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        } else {
            String::from_utf8(bytes)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
        }
    }
    fn poll(&mut self, lines: &mut Vec<String>) -> io::Result<bool> {
        let mut activity = false;
        if self.closed {
            return Ok(activity);
        }
        let mut buffer = [0; 8192];
        // Bound each poll so a noisy pipe cannot starve the other pipe or
        // process/timeout checks. Poll again immediately when data was read.
        for _ in 0..32 {
            match self.read_ready(&mut buffer) {
                Ok(0) => {
                    self.closed = true;
                    if !self.partial.is_empty() {
                        lines.push(self.line(false)?);
                    }
                    break;
                }
                Ok(length) => {
                    activity = true;
                    for part in buffer[..length].split_inclusive(|byte| *byte == b'\n') {
                        if part.last() == Some(&b'\n') {
                            self.partial.extend_from_slice(&part[..part.len() - 1]);
                            lines.push(self.line(true)?);
                        } else {
                            self.partial.extend_from_slice(part);
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            }
        }
        Ok(activity)
    }
}

#[derive(Default)]
pub struct Batch {
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub activity: bool,
}
pub struct Output {
    stdout: Pipe<ChildStdout>,
    stderr: Option<Pipe<ChildStderr>>,
}
impl Output {
    pub fn new(stdout: ChildStdout, stderr: Option<ChildStderr>) -> io::Result<Self> {
        Ok(Self {
            stdout: Pipe::new(stdout, false)?,
            stderr: stderr.map(|stderr| Pipe::new(stderr, true)).transpose()?,
        })
    }
    pub fn poll(&mut self) -> io::Result<Batch> {
        let mut batch = Batch::default();
        batch.activity = self.stdout.poll(&mut batch.stdout)?;
        if let Some(stderr) = self.stderr.as_mut() {
            batch.activity |= stderr.poll(&mut batch.stderr)?;
        }
        Ok(batch)
    }
    pub fn closed(&self) -> bool {
        self.stdout.closed && self.stderr.as_ref().is_none_or(|pipe| pipe.closed)
    }
}

#[cfg(all(test, windows))]
pub(crate) mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::{
        fs,
        path::PathBuf,
        process::Stdio,
        time::{Duration, Instant},
    };

    pub(crate) struct Fixture {
        directory: PathBuf,
        pub script: PathBuf,
        pub pids: PathBuf,
    }
    impl Fixture {
        pub fn new(body: &str) -> Self {
            let directory =
                std::env::temp_dir().join(format!("velum-child-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&directory).unwrap();
            let script = directory.join("fixture.ps1");
            let pids = directory.join("pids.txt");
            fs::write(
                &script,
                format!("param([string]$pidFile)\n$ErrorActionPreference = 'Stop'\n{body}\n"),
            )
            .unwrap();
            Self {
                directory,
                script,
                pids,
            }
        }
        pub fn command(&self) -> Command {
            let mut command = Command::new("powershell.exe");
            command
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&self.script)
                .arg(&self.pids)
                .creation_flags(0x08000000)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            command
        }
        pub fn recorded_pids(&self) -> Vec<u32> {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if let Ok(text) = fs::read_to_string(&self.pids) {
                    let pids: Vec<u32> =
                        text.lines().filter_map(|line| line.parse().ok()).collect();
                    if !pids.is_empty() {
                        return pids;
                    }
                }
                assert!(
                    Instant::now() < deadline,
                    "fixture never recorded its own PIDs"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.script);
            let _ = fs::remove_file(&self.pids);
            let _ = fs::remove_dir(&self.directory);
        }
    }

    pub fn alive(pid: u32) -> bool {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows::Win32::{
            Foundation::HANDLE,
            System::Threading::{
                GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        };
        // Query only PIDs created by this fixture; never enumerate or stop
        // unrelated processes by executable name.
        let Ok(handle) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
        else {
            return false;
        };
        let handle = unsafe { OwnedHandle::from_raw_handle(handle.0) };
        let mut code = 0;
        unsafe { GetExitCodeProcess(HANDLE(handle.as_raw_handle()), &mut code) }.is_ok()
            && code == 259
    }
    pub fn assert_stopped(pids: &[u32]) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while pids.iter().any(|pid| alive(*pid)) {
            assert!(
                Instant::now() < deadline,
                "fixture processes survived cleanup: {pids:?}"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    pub const SPAWN_DESCENDANT: &str = r#"
$taskInfo = New-Object System.Diagnostics.ProcessStartInfo
$taskInfo.FileName = Join-Path $PSHOME 'powershell.exe'
$taskInfo.Arguments = '-NoProfile -Command "[Console]::Out.WriteLine(''descendant ready''); [Console]::Error.WriteLine(''descendant stderr''); Start-Sleep -Seconds 60"'
$taskInfo.UseShellExecute = $false
$taskInfo.CreateNoWindow = $true
$taskChild = [System.Diagnostics.Process]::Start($taskInfo)
[IO.File]::WriteAllText($pidFile, "$PID`n$($taskChild.Id)")
"#;

    #[test]
    fn fast_shims_join_the_job_before_running_and_are_resumed() {
        for _ in 0..10 {
            let mut command = Command::new("cmd.exe");
            command
                .args(["/D", "/C", "echo ready"])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            let mut child = Child::spawn(&mut command).unwrap();
            let mut output = Output::new(child.stdout.take().unwrap(), None).unwrap();
            let deadline = Instant::now() + Duration::from_secs(3);
            let mut lines = Vec::new();
            while !output.closed() {
                lines.extend(output.poll().unwrap().stdout);
                assert!(
                    Instant::now() < deadline,
                    "fast shim did not resume or close its output"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            assert_eq!(lines, ["ready"]);
            assert!(child.wait().unwrap().success());
        }
    }

    #[test]
    fn polling_partial_output_never_waits_for_a_newline_and_preserves_utf8() {
        let fixture = Fixture::new(
            r#"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::Out.Write('partial-')
[Console]::Out.Write([char]0x03bc)
[Console]::Error.WriteLine('diagnostic')
[IO.File]::WriteAllText($pidFile, [string]$PID)
Start-Sleep -Seconds 60
"#,
        );
        let mut child = Child::spawn(&mut fixture.command()).unwrap();
        let mut output = Output::new(child.stdout.take().unwrap(), child.stderr.take()).unwrap();
        let pids = fixture.recorded_pids();
        let before = Instant::now();
        let batch = output.poll().unwrap();
        assert!(before.elapsed() < Duration::from_secs(1));
        assert!(batch.activity);
        assert!(batch.stdout.is_empty());
        assert_eq!(batch.stderr, ["diagnostic"]);
        assert!(!output.closed());
        drop(child);
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut lines = Vec::new();
        while !output.closed() {
            lines.extend(output.poll().unwrap().stdout);
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(lines, ["partial-μ"]);
        assert_stopped(&pids);
    }

    #[test]
    fn output_drains_both_streams_and_the_final_unterminated_line() {
        let fixture = Fixture::new(
            r#"
[Console]::Out.Write("first`r`nsecond`nlast")
[Console]::Error.WriteLine('diagnostic')
[Console]::OpenStandardError().Write([byte[]]@(0xff, 0x0a), 0, 2)
exit 7
"#,
        );
        let mut child = Child::spawn(&mut fixture.command()).unwrap();
        let mut output = Output::new(child.stdout.take().unwrap(), child.stderr.take()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        while !output.closed() {
            let batch = output.poll().unwrap();
            stdout.extend(batch.stdout);
            stderr.extend(batch.stderr);
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(stdout, ["first", "second", "last"]);
        assert_eq!(stderr, ["diagnostic", "�"]);
        assert_eq!(child.wait().unwrap().code(), Some(7));
    }

    #[test]
    fn job_stops_descendants_that_hold_both_pipes_after_parent_exit() {
        let fixture = Fixture::new(
            r#"
[Console]::Out.WriteLine('descendant ready')
[Console]::Error.WriteLine('descendant stderr')
[IO.File]::WriteAllText($pidFile, [string]$PID)
Start-Sleep -Seconds 60
"#,
        );
        // `start /B` inherits the shim's actual pipes, unlike .NET's
        // Process.Start with unredirected streams in a hidden console.
        let mut command = Command::new("cmd.exe");
        command.raw_arg("/D /S /C \"start \"\" /B powershell.exe -NoProfile -ExecutionPolicy Bypass -File fixture.ps1 pids.txt\"")
            .current_dir(&fixture.directory).creation_flags(0x08000000)
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = Child::spawn(&mut command).unwrap();
        let mut output = Output::new(child.stdout.take().unwrap(), child.stderr.take()).unwrap();
        let pids = fixture.recorded_pids();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        loop {
            let batch = output.poll().unwrap();
            stdout.extend(batch.stdout);
            stderr.extend(batch.stderr);
            if child.try_wait().unwrap().is_some() && !stdout.is_empty() && !stderr.is_empty() {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "fixture did not finish: stdout={stdout:?}, stderr={stderr:?}, exit={:?}",
                child.try_wait().unwrap()
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            !output.closed(),
            "fixture must reproduce orphaned inherited pipes"
        );
        assert_eq!(stdout, ["descendant ready"]);
        assert_eq!(stderr, ["descendant stderr"]);
        assert!(alive(pids[0]));
        drop(child);
        assert_stopped(&pids);
        let deadline = Instant::now() + Duration::from_secs(3);
        while !output.closed() {
            output.poll().unwrap();
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn stopping_an_old_turn_handle_cannot_stop_the_next_child() {
        let old_fixture = Fixture::new("Start-Sleep -Seconds 60");
        let old = SharedChild::new(Child::spawn(&mut old_fixture.command()).unwrap());
        old.stop();
        let next_fixture = Fixture::new("Start-Sleep -Seconds 60");
        let child = Child::spawn(&mut next_fixture.command()).unwrap();
        let pid = child.id();
        let next = SharedChild::new(child);
        old.stop();
        assert_eq!(old.status().unwrap(), Status::Stopped);
        assert_eq!(next.status().unwrap(), Status::Running);
        assert!(alive(pid));
        next.stop();
        assert_stopped(&[pid]);
    }
}
