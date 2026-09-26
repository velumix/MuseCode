// ADB boundary fixture for the native USB smoke test. Never touches a real phone.
using System;
using System.IO;
public class AdbFixture {
    public static int Main(string[] args) {
        string directory = Environment.GetEnvironmentVariable("MUSE_QA_ADB_DIR");
        if (String.IsNullOrEmpty(directory)) return 1;
        string command = String.Join(" ", args);
        string route = Path.Combine(directory, "route.txt");
        if (command == "devices -l") Console.WriteLine("List of devices attached\nUSB_FIXTURE device model:USB_Test_Phone transport_id:1");
        else if (command.Contains("shell pm list packages")) Console.WriteLine("package:com.velumix.musecode.phone");
        else if (command.Contains("reverse --list")) { if (File.Exists(route)) Console.WriteLine(File.ReadAllText(route)); }
        else if (command.Contains("reverse --no-rebind tcp:43827 tcp:43827")) File.WriteAllText(route, "UsbFfs tcp:43827 tcp:43827");
        else if (command.Contains("reverse --remove tcp:43827")) File.Delete(route);
        else if (command.Contains("muse_usb_url")) { File.WriteAllText(Path.Combine(directory, "invitation.txt"), args[args.Length - 1]); Console.WriteLine("Status: ok"); }
        else return 1;
        return 0;
    }
}
