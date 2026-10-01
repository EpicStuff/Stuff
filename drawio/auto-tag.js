Draw.loadPlugin(function(ui)
{
	var graph = ui.editor.graph;
	var model = graph.getModel();
	var settingsKey = 'drawioPidAutoTag';

	var defaultSettings = {
		enabled: true,
		startNumber: 101,
		format: '%Prefix%-%Number%',
		familyPrefixes: [
			'pumps=P',
			'filters=F',
			'mixers=R',
			'agitators=R',
			'vessels=B',
			'heat_exchangers=W',
			'compressors=V',
			'centrifuges=S',
			'driers=T',
			'feeders=X',
			'crushers_grinding=Z'
		].join('\n')
	};

	function getSettings()
	{
		var result = {
			enabled: defaultSettings.enabled,
			startNumber: defaultSettings.startNumber,
			format: defaultSettings.format,
			familyPrefixes: defaultSettings.familyPrefixes
		};

		if (typeof mxSettings != 'undefined' && mxSettings.settings != null &&
			mxSettings.settings[settingsKey] != null)
		{
			var saved = mxSettings.settings[settingsKey];

			for (var key in result)
			{
				if (saved[key] != null)
				{
					result[key] = saved[key];
				}
			}
		}

		return result;
	}

	var settings = getSettings();

	function saveSettings()
	{
		if (typeof mxSettings != 'undefined' && mxSettings.settings != null)
		{
			mxSettings.settings[settingsKey] = {
				enabled: settings.enabled,
				startNumber: settings.startNumber,
				format: settings.format,
				familyPrefixes: settings.familyPrefixes
			};

			mxSettings.save();
		}
	}

	function parsePrefixMap(text)
	{
		var result = {};
		var lines = text.split(/\r?\n/);

		for (var i = 0; i < lines.length; i++)
		{
			var line = mxUtils.trim(lines[i]);

			if (line == '' || line.charAt(0) == '#')
			{
				continue;
			}

			var separator = line.indexOf('=');

			if (separator < 1)
			{
				throw new Error('Invalid prefix mapping on line ' + (i + 1));
			}

			var family = mxUtils.trim(line.substring(0, separator)).toLowerCase();
			var prefix = mxUtils.trim(line.substring(separator + 1));

			if (family == '' || prefix == '')
			{
				throw new Error('Invalid prefix mapping on line ' + (i + 1));
			}

			result[family] = prefix;
		}

		return result;
	}

	function getVertices(cells)
	{
		var result = [];

		for (var i = 0; cells != null && i < cells.length; i++)
		{
			if (model.isVertex(cells[i]))
			{
				result.push(cells[i]);
			}
		}

		return result;
	}

	function getShapeName(cell)
	{
		var style = graph.getCellStyle(cell);

		return mxUtils.getValue(style, mxConstants.STYLE_SHAPE, '');
	}

	function getFamily(cell, prefixMap)
	{
		var shape = getShapeName(cell).toLowerCase();

		for (var family in prefixMap)
		{
			if (shape.indexOf('.pid.' + family + '.') >= 0 ||
				shape.indexOf('.pid.' + family) == shape.length - family.length - 5)
			{
				return family;
			}
		}

		return null;
	}

	function getObjectValue(cell)
	{
		var current = model.getValue(cell);

		if (mxUtils.isNode(current))
		{
			return current.cloneNode(true);
		}

		var doc = mxUtils.createXmlDocument();
		var value = doc.createElement('object');
		value.setAttribute('label', current == null ? '' : String(current));
		return value;
	}

	function getTag(cell)
	{
		var value = model.getValue(cell);

		if (mxUtils.isNode(value))
		{
			return value.getAttribute('Tag') || '';
		}

		return '';
	}

	function setTag(cell, tag)
	{
		var value = getObjectValue(cell);
		value.setAttribute('Tag', tag);
		model.setValue(cell, value);
	}

	function escapeRegex(text)
	{
		return text.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
	}

	function getUsedNumbers(prefix)
	{
		var result = {};
		var escaped = escapeRegex(prefix);
		var regex = new RegExp('^' + escaped + '[\\s-]?(\\d+)$', 'i');
		var cells = getVertices(model.getDescendants(model.getRoot()));

		for (var i = 0; i < cells.length; i++)
		{
			var tag = getTag(cells[i]);
			var match = regex.exec(tag);

			if (match != null)
			{
				result[parseInt(match[1], 10)] = true;
			}
		}

		return result;
	}

	function nextNumber(prefix, reserved)
	{
		var number = Math.max(0, parseInt(settings.startNumber, 10) || 101);

		while (reserved[number])
		{
			number++;
		}

		reserved[number] = true;
		return number;
	}

	function formatTag(prefix, number)
	{
		return settings.format
			.replace(/%Prefix%/g, prefix)
			.replace(/%Number%/g, String(number));
	}

	function autoTag(cells, force)
	{
		var prefixMap;

		try
		{
			prefixMap = parsePrefixMap(settings.familyPrefixes);
		}
		catch (e)
		{
			mxUtils.alert(e.message);
			return;
		}

		var vertices = getVertices(cells);
		var usedByPrefix = {};
		model.beginUpdate();

		try
		{
			for (var i = 0; i < vertices.length; i++)
			{
				var cell = vertices[i];
				var existing = getTag(cell);

				if (!force && existing != '')
				{
					continue;
				}

				var family = getFamily(cell, prefixMap);

				if (family == null)
				{
					continue;
				}

				var prefix = prefixMap[family];

				if (usedByPrefix[prefix] == null)
				{
					usedByPrefix[prefix] = getUsedNumbers(prefix);
				}

				var number = nextNumber(prefix, usedByPrefix[prefix]);
				setTag(cell, formatTag(prefix, number));
			}
		}
		finally
		{
			model.endUpdate();
		}
	}

	function addLabel(container, text)
	{
		var label = document.createElement('div');
		label.style.margin = '10px 0 4px';
		label.style.fontWeight = 'bold';
		mxUtils.write(label, text);
		container.appendChild(label);
	}

	function showSettings()
	{
		var container = document.createElement('div');
		container.style.padding = '12px';

		var enabledLabel = document.createElement('label');
		var enabledInput = document.createElement('input');
		enabledInput.type = 'checkbox';
		enabledInput.checked = settings.enabled;
		enabledInput.style.marginRight = '8px';
		enabledLabel.appendChild(enabledInput);
		mxUtils.write(enabledLabel, 'Automatically tag newly inserted P&ID equipment');
		container.appendChild(enabledLabel);

		addLabel(container, 'Starting number');
		var startInput = document.createElement('input');
		startInput.type = 'number';
		startInput.min = '0';
		startInput.value = settings.startNumber;
		startInput.style.width = '100%';
		container.appendChild(startInput);

		addLabel(container, 'Tag format');
		var formatInput = document.createElement('input');
		formatInput.type = 'text';
		formatInput.value = settings.format;
		formatInput.style.width = '100%';
		container.appendChild(formatInput);

		var formatHelp = document.createElement('div');
		formatHelp.style.fontSize = '11px';
		formatHelp.style.marginTop = '4px';
		mxUtils.write(formatHelp, 'Use %Prefix% and %Number%. Example: %Prefix%-%Number%');
		container.appendChild(formatHelp);

		addLabel(container, 'P&ID family prefixes');
		var mapInput = document.createElement('textarea');
		mapInput.style.width = '100%';
		mapInput.style.height = '160px';
		mapInput.value = settings.familyPrefixes;
		container.appendChild(mapInput);

		var mapHelp = document.createElement('div');
		mapHelp.style.fontSize = '11px';
		mapHelp.style.marginTop = '4px';
		mxUtils.write(mapHelp, 'One mapping per line, for example pumps=P. Unmapped shape families are ignored.');
		container.appendChild(mapHelp);

		var buttons = document.createElement('div');
		buttons.style.marginTop = '18px';
		buttons.style.textAlign = 'right';

		var apply = mxUtils.button('Apply to Selection', function()
		{
			try
			{
				parsePrefixMap(mapInput.value);
				settings.enabled = enabledInput.checked;
				settings.startNumber = parseInt(startInput.value, 10) || 101;
				settings.format = formatInput.value;
				settings.familyPrefixes = mapInput.value;
				saveSettings();
				autoTag(graph.getSelectionCells(), false);
			}
			catch (e)
			{
				mxUtils.alert(e.message);
			}
		});
		apply.style.marginRight = '8px';
		buttons.appendChild(apply);

		var cancel = mxUtils.button(mxResources.get('cancel'), function()
		{
			ui.hideDialog();
		});
		cancel.style.marginRight = '8px';
		buttons.appendChild(cancel);

		buttons.appendChild(mxUtils.button(mxResources.get('save'), function()
		{
			try
			{
				parsePrefixMap(mapInput.value);
				settings.enabled = enabledInput.checked;
				settings.startNumber = parseInt(startInput.value, 10) || 101;
				settings.format = formatInput.value;
				settings.familyPrefixes = mapInput.value;
				saveSettings();
				ui.hideDialog();
			}
			catch (e)
			{
				mxUtils.alert(e.message);
			}
		}));

		container.appendChild(buttons);
		ui.showDialog(container, 520, 560, true, true);
	}

	mxResources.parse(
		'pidAutoTagSettings=P&ID Auto Tag...' +
		'\npidAutoTagSelection=Auto Tag Selection'
	);

	ui.actions.addAction('pidAutoTagSettings...', showSettings);
	ui.actions.addAction('pidAutoTagSelection', function()
	{
		autoTag(graph.getSelectionCells(), false);
	});

	var extras = ui.menus.get('extras');
	var oldExtras = extras.funct;
	extras.funct = function(menu, parent)
	{
		oldExtras.apply(this, arguments);
		ui.menus.addMenuItems(menu, ['-', 'pidAutoTagSettings', 'pidAutoTagSelection'], parent);
	};

	graph.addListener(mxEvent.CELLS_ADDED, function(sender, evt)
	{
		if (settings.enabled)
		{
			autoTag(evt.getProperty('cells'), false);
		}
	});
});
