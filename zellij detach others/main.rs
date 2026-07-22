use std::{
	collections::BTreeMap,
	fs::{self, OpenOptions},
	path::PathBuf,
};
use zellij_tile::prelude::*;

#[derive(Default)]
struct State {
	lock_path: Option<PathBuf>,
}

register_plugin!(State);

impl State {
	fn claim_owner(&mut self) -> bool {
		let plugin_ids = get_plugin_ids();
		let lock_path = PathBuf::from(format!(
			"/cache/detach-others-{}-{}",
			plugin_ids.zellij_pid,
			plugin_ids.plugin_id,
		));

		match OpenOptions::new()
			.write(true)
			.create_new(true)
			.open(&lock_path)
		{
			Ok(_) => {
				self.lock_path = Some(lock_path);
				true
			}
			Err(_) => false,
		}
	}

	fn release_owner(&mut self) {
		if let Some(lock_path) = self.lock_path.take() {
			let _ = fs::remove_file(lock_path);
		}
	}

	fn finish(&mut self, disconnect: bool) {
		if self.lock_path.is_none() {
			return;
		}

		if disconnect {
			disconnect_other_clients();
		}

		self.release_owner();
		close_self();
	}
}

impl ZellijPlugin for State {
	fn load(&mut self, _configuration: BTreeMap<String, String>) {
		if !self.claim_owner() {
			return;
		}

		subscribe(&[EventType::PermissionRequestResult]);
		request_permission(&[PermissionType::ChangeApplicationState]);
	}

	fn update(&mut self, event: Event) -> bool {
		match event {
			Event::PermissionRequestResult(PermissionStatus::Granted) => {
				self.finish(true);
			}
			Event::PermissionRequestResult(PermissionStatus::Denied) => {
				self.finish(false);
			}
			_ => {}
		}

		false
	}
}
