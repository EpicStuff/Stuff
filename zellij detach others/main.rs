use std::collections::BTreeMap;
use zellij_tile::prelude::*;

#[derive(Default)]
struct State {
	finished: bool,
}

register_plugin!(State);

impl ZellijPlugin for State {
	fn load(&mut self, _configuration: BTreeMap<String, String>) {
		subscribe(&[EventType::PermissionRequestResult]);

		request_permission(&[
			PermissionType::ReadApplicationState,
			PermissionType::ChangeApplicationState,
		]);
	}

	fn update(&mut self, event: Event) -> bool {
		if self.finished {
			return false;
		}

		match event {
			Event::PermissionRequestResult(PermissionStatus::Granted) => {
				let plugin_id = get_plugin_ids().plugin_id;

				let belongs_to_invoking_client = matches!(
					get_focused_pane_info(),
					Ok((_, PaneId::Plugin(focused_plugin_id)))
						if focused_plugin_id == plugin_id
				);

				if belongs_to_invoking_client {
					self.finished = true;

					eprintln!("disconnecting other clients");
					disconnect_other_clients();

					eprintln!("closing plugin pane");
					close_plugin_pane(plugin_id);
				}
			}
			Event::PermissionRequestResult(PermissionStatus::Denied) => {
				self.finished = true;
				close_self();
			}
			_ => {}
		}

		false
	}
}