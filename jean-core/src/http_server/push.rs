//! Per-device Web Push. Delivery is server-owned and works without a connected UI.
use crate::runtime::AppHandle;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::StreamExt;
use p256::{pkcs8::EncodePrivateKey, SecretKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use web_push::{ContentEncoding, SubscriptionInfo, VapidSignatureBuilder, WebPushMessageBuilder};

#[derive(Default, Clone, Serialize, Deserialize)]
struct Store {
    private_key: Option<String>,
    subscriptions: Vec<SubscriptionInfo>,
}

static PUSH_PERMITS: once_cell::sync::Lazy<tokio::sync::Semaphore> =
    once_cell::sync::Lazy::new(|| tokio::sync::Semaphore::new(8));

static PUSH_EVENT_PERMITS: once_cell::sync::Lazy<tokio::sync::Semaphore> =
    once_cell::sync::Lazy::new(|| tokio::sync::Semaphore::new(8));

pub struct PushState {
    path: PathBuf,
    store: Mutex<Store>,
    recent: Mutex<HashMap<String, Instant>>,
    client: reqwest::Client,
}

impl PushState {
    fn load(path: PathBuf) -> Result<Self, String> {
        let store = match std::fs::read(&path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("Invalid push store: {e}"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Store::default(),
            Err(e) => return Err(format!("Cannot read push store: {e}")),
        };
        Ok(Self {
            path,
            store: Mutex::new(store),
            recent: Mutex::new(HashMap::new()),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.to_string())?,
        })
    }

    // Caller holds the store lock. Commit to memory only after the atomic disk write.
    fn save(&self, store: &Store) -> Result<(), String> {
        use std::io::Write;
        let bytes = serde_json::to_vec(store).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("tmp");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match std::fs::remove_file(&temporary) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Cannot replace push temporary file: {error}")),
        }
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(temporary, &self.path).map_err(|e| e.to_string())
    }

    fn public_key(&self) -> Result<String, String> {
        let mut store = self.store.lock().map_err(|e| e.to_string())?;
        if store.private_key.is_none() {
            let key = SecretKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
            let mut next = store.clone();
            next.private_key = Some(
                key.to_pkcs8_pem(Default::default())
                    .map_err(|e| e.to_string())?
                    .to_string(),
            );
            self.save(&next)?;
            *store = next;
        }
        let pem = store
            .private_key
            .as_ref()
            .ok_or("Notification signing key is unavailable")?;
        let key =
            VapidSignatureBuilder::from_pem_no_sub(pem.as_bytes()).map_err(|e| e.to_string())?;
        Ok(URL_SAFE_NO_PAD.encode(key.get_public_key()))
    }

    fn subscribe(&self, subscription: SubscriptionInfo) -> Result<(), String> {
        validate_subscription(&subscription)?;
        let mut store = self.store.lock().map_err(|e| e.to_string())?;
        let mut next = store.clone();
        next.subscriptions
            .retain(|s| s.endpoint != subscription.endpoint);
        if next.subscriptions.len() >= 100 {
            return Err("Too many notification devices".into());
        }
        next.subscriptions.push(subscription);
        self.save(&next)?;
        *store = next;
        Ok(())
    }

    fn remove(&self, endpoint: &str) -> Result<(), String> {
        let mut store = self.store.lock().map_err(|e| e.to_string())?;
        let mut next = store.clone();
        next.subscriptions.retain(|s| s.endpoint != endpoint);
        self.save(&next)?;
        *store = next;
        Ok(())
    }

    fn request(
        &self,
        subscription: &SubscriptionInfo,
        payload: &Value,
    ) -> Result<reqwest::Request, String> {
        validate_subscription(subscription)?;
        let pem = self
            .store
            .lock()
            .map_err(|e| e.to_string())?
            .private_key
            .clone()
            .ok_or("Notification signing key is unavailable")?;
        let mut signature = VapidSignatureBuilder::from_pem(pem.as_bytes(), subscription)
            .map_err(|e| e.to_string())?;
        signature.add_claim("sub", "https://github.com/Josephkready/jean");
        let bytes = serde_json::to_vec(payload).map_err(|e| e.to_string())?;
        let mut builder = WebPushMessageBuilder::new(subscription);
        builder.set_ttl(3600);
        builder.set_payload(ContentEncoding::Aes128Gcm, &bytes);
        builder.set_vapid_signature(signature.build().map_err(|e| e.to_string())?);
        let request = web_push::request_builder::build_request::<Vec<u8>>(
            builder.build().map_err(|e| e.to_string())?,
        );
        // web-push uses http 0.2; reqwest uses http 1. Transfer the wire headers.
        let mut post = self.client.post(subscription.endpoint.as_str());
        for (name, value) in request.headers() {
            post = post.header(name.as_str(), value.as_bytes());
        }
        post.body(request.into_body())
            .build()
            .map_err(|e| e.to_string())
    }

    async fn send(&self, subscription: &SubscriptionInfo, payload: &Value) -> Result<bool, String> {
        let request = self.request(subscription, payload)?;
        let response = self
            .client
            .execute(request)
            .await
            .map_err(|_| "Cannot reach push service".to_string())?;
        match response.status().as_u16() {
            404 | 410 => Ok(false),
            200..=299 => Ok(true),
            status => Err(format!("Push service returned HTTP {status}")),
        }
    }
}

fn validate_subscription(subscription: &SubscriptionInfo) -> Result<(), String> {
    let url = reqwest::Url::parse(&subscription.endpoint).map_err(|_| "Invalid push endpoint")?;
    let host = url.host_str().unwrap_or_default();
    // Only browser push services: never send authenticated requests to arbitrary/LAN URLs.
    let allowed = host == "fcm.googleapis.com"
        || host == "updates.push.services.mozilla.com"
        || host.ends_with(".push.apple.com")
        || host.ends_with(".notify.windows.com");
    if !allowed
        || url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || subscription.endpoint.len() > 4096
    {
        return Err("Unsupported browser push endpoint".into());
    }
    let public = URL_SAFE_NO_PAD
        .decode(&subscription.keys.p256dh)
        .map_err(|_| "Invalid push public key")?;
    if public.len() != 65
        || p256::PublicKey::from_sec1_bytes(&public).is_err()
        || URL_SAFE_NO_PAD
            .decode(&subscription.keys.auth)
            .map_err(|_| "Invalid push auth key")?
            .len()
            != 16
    {
        return Err("Invalid push keys".into());
    }
    Ok(())
}

fn notification_for_event(event: &str, payload: &Value) -> Option<Value> {
    let session = payload
        .get("session_id")
        .or_else(|| payload.get("sessionId"))?
        .as_str()?;
    let title = match event {
        "chat:done" if payload.get("cancelled").and_then(Value::as_bool) != Some(true) => {
            if payload.get("waiting_for_plan").and_then(Value::as_bool) == Some(true) {
                "Plan ready for review"
            } else {
                "Session finished"
            }
        }
        "chat:permission_denied"
        | "chat:codex_command_approval_request"
        | "chat:codex_permission_request"
        | "chat:opencode_permission_request"
        | "chat:codex_user_input_request"
        | "chat:codex_mcp_elicitation_request"
        | "chat:codex_dynamic_tool_call_request" => "Session needs your input",
        "chat:tool_use"
            if matches!(
                payload.get("name").and_then(Value::as_str),
                Some("AskUserQuestion" | "question" | "request_user_input")
            ) =>
        {
            "Session needs your input"
        }
        "terminal:attention" => "Session needs your input",
        "chat:error" => "Session failed",
        _ => return None,
    };
    Some(
        json!({"title": title, "body": "Open Jean to view the session.", "tag": format!("jean-{session}"), "url": "/"}),
    )
}

async fn deliver_all<T, F, Fut>(items: Vec<T>, send: F)
where
    F: FnMut(T) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    futures_util::stream::iter(items)
        .for_each_concurrent(8, send)
        .await;
}

fn is_duplicate(recent: &Mutex<HashMap<String, Instant>>, key: String, now: Instant) -> bool {
    let mut recent = recent.lock().unwrap_or_else(|error| {
        log::error!("Web Push dedup lock poisoned: {error}");
        error.into_inner()
    });
    recent.retain(|_, time| now.duration_since(*time) < Duration::from_secs(10));
    if recent.contains_key(&key) {
        return true;
    }
    recent.insert(key, now);
    false
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let state = PushState::load(app.path().app_data_dir()?.join("web-push.json"))?;
    app.manage(state);
    for name in [
        "chat:done",
        "chat:error",
        "chat:tool_use",
        "terminal:attention",
        "chat:permission_denied",
        "chat:codex_command_approval_request",
        "chat:codex_permission_request",
        "chat:opencode_permission_request",
        "chat:codex_user_input_request",
        "chat:codex_mcp_elicitation_request",
        "chat:codex_dynamic_tool_call_request",
    ] {
        let app = app.clone();
        let context = app.clone();
        app.listen(name, move |event| {
            let Some(state) = context.try_state::<PushState>() else {
                return;
            };
            let empty = match state.store.lock() {
                Ok(store) => store.subscriptions.is_empty(),
                Err(error) => {
                    log::error!("Web Push store lock poisoned: {error}");
                    error.into_inner().subscriptions.is_empty()
                }
            };
            if empty {
                return;
            }
            let Ok(payload) = serde_json::from_str::<Value>(event.payload()) else {
                return;
            };
            let Some(notification) = notification_for_event(name, &payload) else {
                return;
            };
            // Some backends emit the terminal marker twice. Bound this dedup window.
            let key = format!(
                "{}:{}:{}",
                notification["tag"],
                notification["title"],
                payload.get("run_id").unwrap_or(&Value::Null)
            );
            if is_duplicate(&state.recent, key, Instant::now()) {
                log::debug!("Suppressed duplicate Web Push event: {name}");
                return;
            }
            let subscriptions = match state.store.lock() {
                Ok(store) => store.subscriptions.clone(),
                Err(error) => {
                    log::error!("Web Push store lock poisoned: {error}");
                    error.into_inner().subscriptions.clone()
                }
            };
            // Bound event jobs before spawning, including jobs waiting for send slots.
            let Ok(event_permit) = PUSH_EVENT_PERMITS.try_acquire() else {
                log::warn!("Web Push event capacity reached; dropping notification event");
                return;
            };
            let context = context.clone();
            crate::async_runtime::spawn(async move {
                let _event_permit = event_permit;
                let state = context.state::<PushState>();
                let started = Instant::now();
                let attempted = subscriptions.len();
                deliver_all(subscriptions, |subscription| {
                    let state = &state;
                    let notification = &notification;
                    async move {
                        let _permit = PUSH_PERMITS.acquire().await;
                        match state.send(&subscription, notification).await {
                            Ok(false) => match state.remove(&subscription.endpoint) {
                                Ok(()) => {
                                    let remaining = state.store.lock().unwrap_or_else(|error| error.into_inner()).subscriptions.len();
                                    log::info!("Removed expired Web Push subscription (HTTP 404/410); {remaining} remaining");
                                },
                                Err(error) => log::warn!(
                                    "Failed to remove expired Web Push subscription: {error}"
                                ),
                            },
                            Ok(true) => log::debug!("Web Push delivery succeeded"),
                            Err(error) => log::warn!("Web Push delivery failed: {error}"),
                        }
                    }
                })
                .await;
                log::debug!("Web Push dispatch finished for {name}: {attempted} subscription(s) attempted in {} ms", started.elapsed().as_millis());
            });
        });
    }
    Ok(())
}

// Uses the existing authenticated command transport; no new unauthenticated HTTP API.
pub async fn dispatch(app: AppHandle, command: &str, args: Value) -> Result<Value, String> {
    let state = app
        .try_state::<PushState>()
        .ok_or("Web Push is unavailable")?;
    match command {
        "has_web_push_subscription" => {
            let endpoint = args
                .get("endpoint")
                .and_then(Value::as_str)
                .ok_or("Missing endpoint")?;
            Ok(json!(state
                .store
                .lock()
                .map_err(|e| e.to_string())?
                .subscriptions
                .iter()
                .any(|s| s.endpoint == endpoint)))
        }
        "get_web_push_key" => Ok(json!(state.public_key()?)),
        "subscribe_web_push" => {
            let subscription = serde_json::from_value(
                args.get("subscription")
                    .cloned()
                    .ok_or("Missing subscription")?,
            )
            .map_err(|e| e.to_string())?;
            state.subscribe(subscription)?;
            Ok(Value::Null)
        }
        "unsubscribe_web_push" => {
            state.remove(
                args.get("endpoint")
                    .and_then(Value::as_str)
                    .ok_or("Missing endpoint")?,
            )?;
            Ok(Value::Null)
        }
        "test_web_push" => {
            let endpoint = args
                .get("endpoint")
                .and_then(Value::as_str)
                .ok_or("Missing endpoint")?;
            let subscription = state
                .store
                .lock()
                .map_err(|e| e.to_string())?
                .subscriptions
                .iter()
                .find(|s| s.endpoint == endpoint)
                .cloned()
                .ok_or("This device is not subscribed")?;
            let live = state.send(&subscription, &json!({"title":"Jean notifications enabled", "body":"This device can receive Jean notifications.", "tag":"jean-test", "url":"/"})).await?;
            if !live {
                if let Err(error) = state.remove(endpoint) {
                    log::warn!(
                        "Failed to remove expired Web Push subscription after test: {error}"
                    );
                    return Err(error);
                }
                let remaining = state
                    .store
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .subscriptions
                    .len();
                log::info!("Removed expired Web Push subscription after test (HTTP 404/410); {remaining} remaining");
                return Err("Subscription expired. Enable notifications again.".into());
            }
            Ok(Value::Null)
        }
        _ => Err("Unknown push command".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::elliptic_curve::sec1::ToEncodedPoint;

    fn subscription(endpoint: &str) -> SubscriptionInfo {
        let key = SecretKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
        SubscriptionInfo::new(
            endpoint.to_string(),
            URL_SAFE_NO_PAD.encode(key.public_key().to_encoded_point(false).as_bytes()),
            URL_SAFE_NO_PAD.encode([42u8; 16]),
        )
    }

    #[test]
    fn identity_and_device_opt_in_survive_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("push.json");
        let state = PushState::load(path.clone()).unwrap();
        let key = state.public_key().unwrap();
        assert_eq!(URL_SAFE_NO_PAD.decode(&key).unwrap().len(), 65);
        let first = subscription("https://web.push.apple.com/device-one");
        let second = subscription("https://fcm.googleapis.com/device-two");
        state.subscribe(first.clone()).unwrap();
        state.subscribe(first.clone()).unwrap();
        state.subscribe(second.clone()).unwrap();
        assert_eq!(state.store.lock().unwrap().subscriptions.len(), 2);
        let restored = PushState::load(path.clone()).unwrap();
        assert_eq!(restored.public_key().unwrap(), key);
        assert_eq!(
            restored.store.lock().unwrap().subscriptions,
            vec![first.clone(), second.clone()]
        );
        restored.remove(&first.endpoint).unwrap();
        let restored = PushState::load(path.clone()).unwrap();
        assert_eq!(restored.store.lock().unwrap().subscriptions, vec![second]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[tokio::test]
    async fn admitted_event_attempts_every_device_beyond_concurrency_limit() {
        let delivered = Mutex::new(Vec::new());
        deliver_all((0..100).collect(), |device| {
            let delivered = &delivered;
            async move {
                tokio::task::yield_now().await;
                delivered.lock().unwrap().push(device);
            }
        })
        .await;
        let mut actual = delivered.into_inner().unwrap();
        actual.sort();
        assert_eq!(actual, (0..100).collect::<Vec<_>>());
    }

    #[test]
    fn duplicate_events_expire_and_distinct_events_are_delivered() {
        let recent = Mutex::new(HashMap::new());
        let now = Instant::now();
        assert!(!is_duplicate(&recent, "run-one".into(), now));
        assert!(is_duplicate(&recent, "run-one".into(), now));
        assert!(!is_duplicate(&recent, "run-two".into(), now));
        assert!(!is_duplicate(
            &recent,
            "run-one".into(),
            now + Duration::from_secs(10)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn save_replaces_stale_world_readable_temporary_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("push.json");
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, "stale").unwrap();
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o666)).unwrap();
        PushState::load(path.clone()).unwrap().public_key().unwrap();
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(!temporary.exists());
    }

    #[test]
    fn delivery_request_has_vapid_signature_and_encrypted_payload() {
        let dir = tempfile::tempdir().unwrap();
        let state = PushState::load(dir.path().join("push.json")).unwrap();
        let public_key = state.public_key().unwrap();
        let sub = subscription("https://web.push.apple.com/encryption-test");
        let request = state.request(&sub, &json!({"title":"Jean test"})).unwrap();
        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(request.headers()["content-encoding"], "aes128gcm");
        assert_eq!(request.headers()["ttl"], "3600");
        let authorization = request.headers()["authorization"].to_str().unwrap();
        assert!(authorization.starts_with("vapid t="));
        assert!(authorization.contains(&format!("k={public_key}")));
        let encrypted = request.body().unwrap().as_bytes().unwrap();
        assert!(encrypted.len() > 100);
        assert!(!encrypted
            .windows(b"Jean test".len())
            .any(|w| w == b"Jean test"));
    }

    #[test]
    fn rejects_non_push_endpoints_and_invalid_keys() {
        for endpoint in [
            "http://web.push.apple.com/x",
            "https://127.0.0.1/x",
            "https://web.push.apple.com.evil.com/x",
            "https://user:pass@web.push.apple.com/x",
            "https://web.push.apple.com:8443/x",
            "https://example.com/x",
        ] {
            assert!(
                validate_subscription(&subscription(endpoint)).is_err(),
                "{endpoint}"
            );
        }
        let mut invalid = subscription("https://web.push.apple.com/x");
        invalid.keys.auth = URL_SAFE_NO_PAD.encode([0u8; 15]);
        assert!(validate_subscription(&invalid).is_err());
        invalid.keys.auth = URL_SAFE_NO_PAD.encode([0u8; 16]);
        invalid.keys.p256dh = URL_SAFE_NO_PAD.encode([0u8; 65]);
        assert!(validate_subscription(&invalid).is_err());
    }

    #[test]
    fn failed_save_does_not_enable_a_device_in_memory() {
        let dir = tempfile::tempdir().unwrap();
        let state = PushState::load(dir.path().join("push.json")).unwrap();
        state.public_key().unwrap();
        std::fs::create_dir(dir.path().join("push.tmp")).unwrap();
        assert!(state
            .subscribe(subscription("https://web.push.apple.com/x"))
            .is_err());
        assert!(state.store.lock().unwrap().subscriptions.is_empty());
    }

    #[test]
    fn corrupt_store_is_not_silently_reset() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("push.json");
        std::fs::write(&path, b"broken").unwrap();
        assert!(PushState::load(path.clone()).is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"broken");
    }

    #[test]
    fn lifecycle_mapping_keeps_private_content_out_of_notifications() {
        let mut payload =
            json!({"session_id":"s1", "worktree_id":"w1", "content":"private prompt"});
        for event in [
            "chat:done",
            "chat:error",
            "chat:permission_denied",
            "chat:codex_permission_request",
            "chat:codex_user_input_request",
            "chat:opencode_permission_request",
        ] {
            let notification = notification_for_event(event, &payload).unwrap();
            assert_eq!(notification["tag"], "jean-s1");
            assert!(!notification.to_string().contains("private prompt"));
        }
        assert!(notification_for_event("chat:chunk", &payload).is_none());
        assert!(notification_for_event(
            "chat:tool_use",
            &json!({"session_id":"s1", "name":"Read"})
        )
        .is_none());
        for name in ["AskUserQuestion", "question", "request_user_input"] {
            assert_eq!(
                notification_for_event("chat:tool_use", &json!({"session_id":"s1", "name":name}))
                    .unwrap()["title"],
                "Session needs your input"
            );
        }
        assert_eq!(
            notification_for_event("terminal:attention", &json!({"sessionId":"s1"})).unwrap()
                ["tag"],
            "jean-s1"
        );
        assert!(notification_for_event("chat:cancelled", &payload).is_none());
        payload["waiting_for_plan"] = json!(true);
        assert_eq!(
            notification_for_event("chat:done", &payload).unwrap()["title"],
            "Plan ready for review"
        );
        payload["cancelled"] = json!(true);
        assert!(notification_for_event("chat:done", &payload).is_none());
    }

    #[tokio::test]
    async fn authenticated_dispatch_registers_and_removes_device() {
        let dir = tempfile::tempdir().unwrap();
        let app = AppHandle::new(dir.path().into(), dir.path().into()).unwrap();
        initialize(&app).unwrap();
        let call =
            |command, args| crate::http_server::dispatch::dispatch_command(&app, command, args);
        assert!(call("get_web_push_key", json!({}))
            .await
            .unwrap()
            .is_string());
        let sub = subscription("https://web.push.apple.com/dispatch-test");
        call("subscribe_web_push", json!({"subscription":sub}))
            .await
            .unwrap();
        assert_eq!(
            call(
                "has_web_push_subscription",
                json!({"endpoint":sub.endpoint})
            )
            .await
            .unwrap(),
            true
        );
        call("unsubscribe_web_push", json!({"endpoint":sub.endpoint}))
            .await
            .unwrap();
        assert_eq!(
            call(
                "has_web_push_subscription",
                json!({"endpoint":sub.endpoint})
            )
            .await
            .unwrap(),
            false
        );
        assert!(call("test_web_push", json!({"endpoint":sub.endpoint}))
            .await
            .is_err());
    }

    // Live seam test: opt in with a disposable browser subscription file. Never runs by default.
    #[tokio::test]
    #[ignore = "requires JEAN_WEB_PUSH_LIVE_SUBSCRIPTION and JEAN_WEB_PUSH_LIVE_STORE"]
    async fn live_browser_push_delivery() {
        let file = std::env::var("JEAN_WEB_PUSH_LIVE_SUBSCRIPTION").unwrap();
        let sub: SubscriptionInfo = serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
        let state =
            PushState::load(std::env::var("JEAN_WEB_PUSH_LIVE_STORE").unwrap().into()).unwrap();
        assert!(state
            .send(
                &sub,
                &json!({"title":"Jean live push test", "body":"Live delivery test", "url":"/"})
            )
            .await
            .unwrap());
    }
}
