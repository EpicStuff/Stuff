function dockerc-up --wraps='docker compose up -d && docker compose logs -f' --description 'alias dockerc-up=docker compose up -d && docker compose logs -f'
	docker compose up -d && docker compose logs -f $argv
end
