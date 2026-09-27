//! Workspace boards are loaded on demand and saved atomically after each edit.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::PathBuf, sync::Mutex};
use tauri::Manager;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Card {
    pub id: String,
    pub title: String,
    pub description: String,
    pub column: String,
    pub priority: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Board {
    pub revision: u64,
    pub cards: Vec<Card>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Load {},
    Save {
        revision: u64,
        card: Card,
    },
    Move {
        revision: u64,
        id: String,
        column: String,
        before: Option<String>,
    },
    Delete {
        revision: u64,
        id: String,
    },
}

pub struct Store {
    root: PathBuf,
    lock: Mutex<()>,
}
fn valid_column(column: &str) -> bool {
    matches!(column, "backlog" | "progress" | "review" | "done")
}
fn validate(card: &Card) -> Result<(), String> {
    if uuid::Uuid::parse_str(&card.id).is_err()
        || card.title.trim().is_empty()
        || card.title.chars().count() > 160
        || card.title.chars().any(char::is_control)
        || card.description.chars().count() > 8000
        || !valid_column(&card.column)
        || !matches!(card.priority.as_str(), "low" | "normal" | "high")
    {
        return Err("Use a title up to 160 characters, details up to 8,000, and a valid status and priority.".into());
    }
    Ok(())
}
impl Store {
    fn path(&self, workspace: &str) -> Result<PathBuf, String> {
        let path = PathBuf::from(workspace)
            .canonicalize()
            .map_err(|e| format!("Cannot open this workspace: {e}"))?;
        if !path.is_dir() {
            return Err("Choose a workspace folder first.".into());
        }
        let name = path.to_string_lossy().into_owned();
        #[cfg(windows)]
        let name = name.to_lowercase();
        Ok(self
            .root
            .join(format!("{:x}.json", Sha256::digest(name.as_bytes()))))
    }
    pub fn request(&self, workspace: &str, request: Request) -> Result<Board, String> {
        let _guard = self.lock.lock().unwrap();
        let path = self.path(workspace)?;
        let mut board = match fs::File::open(&path) {
            Ok(file) => {
                let mut bytes = vec![];
                file.take(4 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() > 4 * 1024 * 1024 {
                    return Err("This board exceeds the storage limit.".into());
                }
                serde_json::from_slice::<Board>(&bytes)
                    .map_err(|e| format!("Cannot read saved board: {e}"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Board::default(),
            Err(e) => return Err(e.to_string()),
        };
        if board.cards.len() > 300 {
            return Err("Board exceeds the 300 card limit.".into());
        }
        for card in &board.cards {
            validate(card)?;
        }
        let revision = match &request {
            Request::Load {} => return Ok(board),
            Request::Save { revision, .. }
            | Request::Move { revision, .. }
            | Request::Delete { revision, .. } => *revision,
        };
        if board.revision != revision {
            return Err("This board changed on another screen. Refresh the board before trying again. Your unsaved card is still here.".into());
        }
        match request {
            Request::Save { mut card, .. } => {
                card.title = card.title.trim().into();
                validate(&card)?;
                if let Some(old) = board.cards.iter_mut().find(|c| c.id == card.id) {
                    *old = card;
                } else {
                    if board.cards.len() >= 300 {
                        return Err("This board is full. Remove a finished card before adding another (300 maximum).".into());
                    }
                    board.cards.push(card);
                }
            }
            Request::Move {
                id, column, before, ..
            } => {
                if !valid_column(&column) {
                    return Err("Unknown column.".into());
                }
                let index = board
                    .cards
                    .iter()
                    .position(|c| c.id == id)
                    .ok_or("This card no longer exists.")?;
                if before.as_ref() == Some(&id) {
                    return Ok(board);
                }
                let mut card = board.cards.remove(index);
                card.column = column.clone();
                let index = match before {
                    Some(before) => board
                        .cards
                        .iter()
                        .position(|c| c.id == before && c.column == column)
                        .ok_or("The destination card changed. Refresh the board.")?,
                    None => board.cards.len(),
                };
                board.cards.insert(index, card);
            }
            Request::Delete { id, .. } => {
                let index = board
                    .cards
                    .iter()
                    .position(|c| c.id == id)
                    .ok_or("This card no longer exists.")?;
                board.cards.remove(index);
            }
            Request::Load {} => unreachable!(),
        }
        board.revision = board
            .revision
            .checked_add(1)
            .ok_or("Board revision limit reached.")?;
        crate::storage::write_json(&path, &board)?;
        Ok(board)
    }
}
pub fn setup(app: &tauri::AppHandle) {
    let root = std::env::var_os("MUSE_CODE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| app.path().app_config_dir().expect("app config directory"))
        .join("boards");
    app.manage(Store {
        root,
        lock: Mutex::new(()),
    });
}
#[tauri::command]
pub async fn kanban_request(
    app: tauri::AppHandle,
    workspace: String,
    request: Request,
) -> Result<Board, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Store>().request(&workspace, request))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn boards_persist_reorder_and_reject_stale_writes() {
        let root = std::env::temp_dir().join(format!("velum-board-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("one")).unwrap();
        fs::create_dir(root.join("two")).unwrap();
        let store = Store {
            root: root.join("saved"),
            lock: Mutex::new(()),
        };
        let workspace = root.join("one").to_string_lossy().into_owned();
        let card = Card {
            id: uuid::Uuid::new_v4().to_string(),
            title: "First".into(),
            description: "Details".into(),
            column: "backlog".into(),
            priority: "high".into(),
        };
        let board = store
            .request(
                &workspace,
                Request::Save {
                    revision: 0,
                    card: card.clone(),
                },
            )
            .unwrap();
        assert_eq!(board.revision, 1);
        assert!(store
            .request(
                &workspace,
                Request::Delete {
                    revision: 0,
                    id: card.id.clone()
                }
            )
            .is_err());
        let mut other = card.clone();
        other.id = uuid::Uuid::new_v4().to_string();
        other.title = "Second".into();
        store
            .request(
                &workspace,
                Request::Save {
                    revision: 1,
                    card: other.clone(),
                },
            )
            .unwrap();
        let board = store
            .request(
                &workspace,
                Request::Move {
                    revision: 2,
                    id: other.id.clone(),
                    column: "backlog".into(),
                    before: Some(card.id.clone()),
                },
            )
            .unwrap();
        assert_eq!(board.cards[0].id, other.id);
        assert!(store
            .request(
                &workspace,
                Request::Move {
                    revision: 3,
                    id: card.id.clone(),
                    column: "bad".into(),
                    before: None
                }
            )
            .is_err());
        assert_eq!(
            store
                .request(&workspace, Request::Load {})
                .unwrap()
                .revision,
            3
        );
        assert!(store
            .request(root.join("two").to_str().unwrap(), Request::Load {})
            .unwrap()
            .cards
            .is_empty());
        let reopened = Store {
            root: root.join("saved"),
            lock: Mutex::new(()),
        };
        assert_eq!(
            reopened
                .request(&workspace, Request::Load {})
                .unwrap()
                .cards
                .len(),
            2
        );
        store
            .request(
                &workspace,
                Request::Delete {
                    revision: 3,
                    id: card.id,
                },
            )
            .unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn card_and_request_limits() {
        let mut card = Card {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Task".into(),
            description: String::new(),
            column: "review".into(),
            priority: "normal".into(),
        };
        validate(&card).unwrap();
        card.title = " ".into();
        assert!(validate(&card).is_err());
        card.title = "Task".into();
        card.description = "x".repeat(8001);
        assert!(validate(&card).is_err());
        assert!(
            serde_json::from_str::<Request>(r#"{"action":"load","workspace":"elsewhere"}"#)
                .is_err()
        );
    }
}
