//! Pairing and revocable device credentials. Only credential hashes reach disk.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

pub const PAIR_SECONDS: u64 = 120;
const DEVICE_SECONDS: u64 = 90 * 24 * 60 * 60;

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub control: bool,
    #[serde(default)]
    pub usb: bool,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub credential_hash: String,
}
impl Device {
    pub fn public(&self) -> Self {
        Self {
            credential_hash: String::new(),
            ..self.clone()
        }
    }
}

pub struct Pairing {
    pub usb: bool,
    pub invitation_hash: String,
    pub expires_at: u64,
    pub code: String,
    pub claim_hash: Option<String>,
    pub name: Option<String>,
    pub device: Option<Device>,
    pub credential: String,
}

#[derive(Serialize, Clone)]
pub struct Pending {
    pub name: String,
    pub code: String,
    pub expires_at: u64,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Saved {
    pub enabled: bool,
    pub devices: Vec<Device>,
}

#[derive(Default)]
pub struct Auth {
    pub saved: Saved,
    pub pairing: Option<Pairing>,
    attempts: u32,
    attempts_since: u64,
}

impl Auth {
    pub fn new(saved: Saved) -> Self {
        Self {
            saved,
            ..Self::default()
        }
    }
    pub fn invite(&mut self, time: u64) -> (String, String) {
        let invitation = secret();
        let code = format!("{:06}", uuid::Uuid::new_v4().as_u128() % 1_000_000);
        self.pairing = Some(Pairing {
            usb: false,
            invitation_hash: hash(&invitation),
            expires_at: time + PAIR_SECONDS,
            code: code.clone(),
            claim_hash: None,
            name: None,
            device: None,
            credential: secret(),
        });
        (invitation, code)
    }

    pub fn claim(
        &mut self,
        invitation: &str,
        claim: &str,
        name: &str,
        time: u64,
    ) -> Result<Pending, &'static str> {
        if time.saturating_sub(self.attempts_since) >= 60 {
            self.attempts = 0;
            self.attempts_since = time;
        }
        self.attempts += 1;
        if self.attempts > 20 {
            return Err("Too many pairing attempts. Wait a minute and try again.");
        }
        if claim.len() != 64 || !claim.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid pairing request.");
        }
        let pair = self
            .pairing
            .as_mut()
            .ok_or("Generate a new QR code on your desktop.")?;
        if pair.expires_at <= time || pair.invitation_hash != hash(invitation) {
            return Err("This QR code has expired. Generate a new one.");
        }
        let claim_hash = hash(claim);
        if pair
            .claim_hash
            .as_ref()
            .is_some_and(|value| *value != claim_hash)
        {
            return Err("This QR code has already been scanned. Generate a new one.");
        }
        let name = name
            .trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(64)
            .collect::<String>();
        if name.is_empty() {
            return Err("Give this phone a name.");
        }
        if pair.claim_hash.is_none() {
            pair.claim_hash = Some(claim_hash);
            pair.name = Some(name);
        }
        Ok(Pending {
            name: pair.name.clone().unwrap_or_default(),
            code: pair.code.clone(),
            expires_at: pair.expires_at,
        })
    }

    pub fn pending(&self, time: u64) -> Option<Pending> {
        self.pairing
            .as_ref()
            .filter(|p| p.expires_at > time && p.device.is_none())
            .and_then(|p| {
                p.name.as_ref().map(|name| Pending {
                    name: name.clone(),
                    code: p.code.clone(),
                    expires_at: p.expires_at,
                })
            })
    }

    pub fn approve(&mut self, code: &str, control: bool, time: u64) -> Result<(), &'static str> {
        self.saved.devices.retain(|d| d.expires_at > time);
        if self.saved.devices.len() >= 10 {
            return Err("Remove a connected device before pairing another.");
        }
        let pair = self.pairing.as_mut().ok_or("Pairing expired.")?;
        if pair.expires_at <= time || pair.code != code || pair.claim_hash.is_none() {
            return Err("Pairing expired or the code changed. Scan again.");
        }
        if pair.device.is_some() {
            return Ok(());
        }
        let device = Device {
            id: uuid::Uuid::new_v4().to_string(),
            name: pair.name.clone().unwrap_or_default(),
            created_at: time,
            expires_at: time + DEVICE_SECONDS,
            control,
            usb: pair.usb,
            credential_hash: hash(&pair.credential),
        };
        self.saved.devices.push(device.clone());
        pair.device = Some(device);
        Ok(())
    }

    pub fn finish(&self, claim: &str, time: u64) -> Result<Option<(&Device, &str)>, &'static str> {
        let pair = self
            .pairing
            .as_ref()
            .ok_or("Pairing was cancelled. Scan a new code.")?;
        if pair.expires_at <= time || pair.claim_hash.as_deref() != Some(hash(claim).as_str()) {
            return Err("Pairing expired. Scan a new code.");
        }
        Ok(pair
            .device
            .as_ref()
            .filter(|device| self.saved.devices.iter().any(|d| d.id == device.id))
            .map(|device| (device, pair.credential.as_str())))
    }

    pub fn authenticate(&self, credential: &str, time: u64) -> Option<Device> {
        if credential.len() != 64 {
            return None;
        }
        let digest = hash(credential);
        self.saved
            .devices
            .iter()
            .find(|d| d.expires_at > time && d.credential_hash == digest)
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pairing_requires_matching_desktop_approval_and_is_single_claim() {
        let mut auth = Auth::default();
        let (invitation, code) = auth.invite(100);
        let claim = secret();
        assert!(auth.approve(&code, true, 101).is_err());
        auth.claim(&invitation, &claim, "My phone", 101).unwrap();
        assert!(auth.finish(&claim, 102).unwrap().is_none());
        assert!(auth.claim(&invitation, &secret(), "Attacker", 102).is_err());
        assert!(auth.approve("wrong", true, 102).is_err());
        auth.approve(&code, true, 102).unwrap();
        let (_, token) = auth.finish(&claim, 103).unwrap().unwrap();
        let token = token.to_owned();
        assert!(auth.authenticate(&token, 103).unwrap().control);
        let disk = serde_json::to_string(&auth.saved).unwrap();
        assert!(!disk.contains(&token));
        assert!(!disk.contains(&invitation));
        auth.saved.devices.clear();
        assert!(auth.authenticate(&token, 104).is_none());
        assert!(auth.finish(&claim, 104).unwrap().is_none());
    }
    #[test]
    fn expired_or_replaced_invitations_cannot_pair() {
        let mut auth = Auth::default();
        let (old, _) = auth.invite(100);
        assert!(auth.claim(&old, &secret(), "phone", 220).is_err());
        let (new, _) = auth.invite(221);
        assert!(auth.claim(&old, &secret(), "phone", 222).is_err());
        assert!(auth.claim(&new, &secret(), "phone", 222).is_ok());
    }
    #[test]
    fn paired_devices_expire_and_view_only_permission_is_preserved() {
        let mut auth = Auth::default();
        let (invitation, code) = auth.invite(100);
        let claim = secret();
        auth.claim(&invitation, &claim, "Phone", 101).unwrap();
        auth.approve(&code, false, 102).unwrap();
        let (device, token) = auth.finish(&claim, 103).unwrap().unwrap();
        assert!(!device.control);
        assert!(auth.authenticate(token, device.expires_at).is_none());
        assert!(auth.authenticate(&invitation, 104).is_none());
        assert!(auth.authenticate(&claim, 104).is_none());
    }
}
