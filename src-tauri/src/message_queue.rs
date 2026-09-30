//! Pending messages belong to the native conversation, shared by desktop and phone.
use serde::{Deserialize, Serialize};

pub const MAX_MESSAGES: usize = 20;
const MAX_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub id: String,
    pub prompt: String,
    pub yolo: bool,
    pub remote: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Snapshot {
    pub items: Vec<Message>,
    pub paused: bool,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Load {},
    Pause {},
    Resume {},
    Remove { message_id: String },
    Edit { message_id: String, prompt: String },
    Clear {},
}

pub fn validate_prompt(prompt: &str) -> Result<(), String> {
    if prompt.trim().is_empty() || prompt.chars().count() > 64_000 {
        return Err("Enter a message of up to 64,000 characters.".into());
    }
    Ok(())
}

impl Snapshot {
    pub fn restore(mut self) -> Result<Self, String> {
        if self.items.len() > MAX_MESSAGES
            || self.items.iter().map(|m| m.prompt.len()).sum::<usize>() > MAX_BYTES
        {
            return Err("Saved message queue exceeds its recovery limit.".into());
        }
        let mut ids = std::collections::HashSet::new();
        for item in &self.items {
            validate_prompt(&item.prompt)?;
            uuid::Uuid::parse_str(&item.id)
                .map_err(|_| "Saved queue has an invalid message ID.")?;
            if !ids.insert(&item.id) || (item.remote && item.yolo) {
                return Err("Saved queue contains an invalid message.".into());
            }
        }
        if !self.items.is_empty() {
            self.pause("Review the recovered messages, then resume the queue.");
        }
        Ok(self)
    }

    pub fn push(&mut self, prompt: String, yolo: bool, remote: bool) -> Result<String, String> {
        validate_prompt(&prompt)?;
        if self.items.len() >= MAX_MESSAGES {
            return Err("The queue is full (20 messages). Remove a pending message or wait for a turn to finish.".into());
        }
        if self.items.iter().map(|m| m.prompt.len()).sum::<usize>() + prompt.len() > MAX_BYTES {
            return Err(
                "The queue is full. Shorten this message or remove a pending message.".into(),
            );
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.items.push(Message {
            id: id.clone(),
            prompt,
            yolo: yolo && !remote,
            remote,
        });
        Ok(id)
    }

    pub fn pause(&mut self, reason: &str) {
        self.paused = true;
        self.reason = Some(reason.chars().take(400).collect());
    }

    pub fn apply(&mut self, request: Request) -> Result<(), String> {
        match request {
            Request::Load {} => {}
            Request::Pause {} => self.pause("Queue paused. The current response can finish."),
            Request::Resume {} => {
                self.paused = false;
                self.reason = None;
            }
            Request::Clear {} => {
                self.items.clear();
                self.paused = false;
                self.reason = None;
            }
            Request::Remove { message_id } => {
                let index = self
                    .items
                    .iter()
                    .position(|m| m.id == message_id)
                    .ok_or("That message has already started or was removed.")?;
                self.items.remove(index);
                if self.items.is_empty() {
                    self.paused = false;
                    self.reason = None;
                }
            }
            Request::Edit { message_id, prompt } => {
                validate_prompt(&prompt)?;
                let item = self
                    .items
                    .iter()
                    .find(|m| m.id == message_id)
                    .ok_or("That message has already started or was removed.")?;
                let bytes = self.items.iter().map(|m| m.prompt.len()).sum::<usize>()
                    - item.prompt.len()
                    + prompt.len();
                if bytes > MAX_BYTES {
                    return Err("Shorten this message to fit the queue.".into());
                }
                self.items
                    .iter_mut()
                    .find(|m| m.id == message_id)
                    .unwrap()
                    .prompt = prompt.trim().to_owned();
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queue_keeps_order_permissions_and_edited_messages() {
        let mut queue = Snapshot::default();
        let first = queue.push("One".into(), true, false).unwrap();
        let second = queue.push("Two".into(), true, true).unwrap();
        assert!(queue.items[0].yolo);
        assert!(!queue.items[1].yolo);
        queue
            .apply(Request::Edit {
                message_id: second.clone(),
                prompt: " Revised ".into(),
            })
            .unwrap();
        assert_eq!(queue.items[1].prompt, "Revised");
        queue.apply(Request::Remove { message_id: first }).unwrap();
        assert_eq!(queue.items[0].id, second);
        queue.apply(Request::Pause {}).unwrap();
        assert!(queue.paused);
        queue.apply(Request::Resume {}).unwrap();
        assert!(!queue.paused);
        assert_eq!(queue.reason, None);
    }
    #[test]
    fn recovered_work_waits_for_review_and_limits_preserve_existing_items() {
        let mut queue = Snapshot::default();
        for _ in 0..MAX_MESSAGES {
            queue.push("Message".into(), false, false).unwrap();
        }
        let previous = queue.clone();
        assert!(queue.push("Overflow".into(), false, false).is_err());
        assert_eq!(queue, previous);
        assert!(queue.clone().restore().unwrap().paused);
        assert!(queue
            .apply(Request::Edit {
                message_id: queue.items[0].id.clone(),
                prompt: "".into()
            })
            .is_err());
        assert_eq!(queue, previous);
        queue.apply(Request::Clear {}).unwrap();
        assert_eq!(queue, Snapshot::default());
    }
}
