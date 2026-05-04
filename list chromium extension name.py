from pathlib import Path
from epicstuff import open, run_install_trace
from json import load


for extension in Path('Default/Extensions').iterdir():
	ext_id = extension.stem
	extension = next(extension.iterdir())
	with open(extension / 'manifest.json') as f:
		name = load(f)['name']

		if name.startswith('__'):
			name = name.replace('__MSG_', '').replace('__', '')

			locales = [loc.name for loc in (extension / '_locales').iterdir()]
			if 'en' in locales:
				file = extension / '_locales' / 'en'
			elif 'en_US' in locales:
				file = extension / '_locales' / 'en_US'
			else:
				file = None

			if file:
				with open(file / 'messages.json') as f:
					name = load(f)[name]['message']

		# print(f'{name}: {ext_id}')
		print(f'{ext_id}: {name}')
