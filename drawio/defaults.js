Draw.loadPlugin(function(ui)
{
	var graph = ui.editor.graph;
	var model = graph.getModel();
	var storageKey = '.drawioPidDefaults';
	var settings = {
		defaultText: '%Tag%\n%Desc%',
		defaultProperties: 'Tag=\nDesc=',
		defaultSpacing: 6,
		applyToNewShapes: true,
		keepExistingText: true
	};

	try
	{
		var saved = JSON.parse(localStorage.getItem(storageKey));

		if (saved != null)
		{
			for (var key in settings)
			{
				if (saved[key] != null)
				{
					settings[key] = saved[key];
				}
			}
		}
	}
	catch (e)
	{
	}

	function saveSettings()
	{
		localStorage.setItem(storageKey, JSON.stringify(settings));
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

	function getDrawableCells(cells)
	{
		var result = [];

		for (var i = 0; cells != null && i < cells.length; i++)
		{
			if (model.isVertex(cells[i]) || model.isEdge(cells[i]))
			{
				result.push(cells[i]);
			}
		}

		return result;
	}

	function parseProperties(text)
	{
		var result = [];
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
				throw new Error('Invalid property on line ' + (i + 1));
			}

			result.push({
				name: mxUtils.trim(line.substring(0, separator)),
				value: line.substring(separator + 1)
			});
		}

		return result;
	}

	function makeObjectValue(cell)
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

	function applySpacing(cells, force)
	{
		var drawable = getDrawableCells(cells);

		for (var i = 0; i < drawable.length; i++)
		{
			var cell = drawable[i];
			var style = model.getStyle(cell) || '';
			var explicit = /(^|;)spacing=/.test(style);

			if (force || !explicit)
			{
				model.setStyle(cell, mxUtils.setStyle(style, mxConstants.STYLE_SPACING, String(settings.defaultSpacing)));
			}
		}
	}

	function applyDefaults(cells, forceSpacing)
	{
		var vertices = getVertices(cells);
		var properties;

		try
		{
			properties = parseProperties(settings.defaultProperties);
		}
		catch (e)
		{
			mxUtils.alert(e.message);
			return;
		}

		model.beginUpdate();

		try
		{
			applySpacing(cells, forceSpacing);

			for (var i = 0; i < vertices.length; i++)
			{
				var cell = vertices[i];
				var value = makeObjectValue(cell);

				for (var j = 0; j < properties.length; j++)
				{
					if (!value.hasAttribute(properties[j].name))
					{
						value.setAttribute(properties[j].name, properties[j].value);
					}
				}

				var label = value.getAttribute('label') || '';

				if (settings.defaultText != '' && (!settings.keepExistingText || label == ''))
				{
					value.setAttribute('label', settings.defaultText);
				}

				if (settings.defaultText.indexOf('%') >= 0)
				{
					value.setAttribute('placeholders', '1');
				}

				model.setValue(cell, value);
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

	function addCheckbox(container, text, checked)
	{
		var wrapper = document.createElement('label');
		wrapper.style.display = 'block';
		wrapper.style.marginTop = '10px';
		var input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = checked;
		input.style.marginRight = '8px';
		wrapper.appendChild(input);
		mxUtils.write(wrapper, text);
		container.appendChild(wrapper);
		return input;
	}

	function showSettings()
	{
		var container = document.createElement('div');
		container.style.padding = '12px';

		addLabel(container, 'Default text');
		var textInput = document.createElement('textarea');
		textInput.style.width = '100%';
		textInput.style.height = '70px';
		textInput.value = settings.defaultText;
		container.appendChild(textInput);

		addLabel(container, 'Default properties');
		var propertiesInput = document.createElement('textarea');
		propertiesInput.style.width = '100%';
		propertiesInput.style.height = '90px';
		propertiesInput.value = settings.defaultProperties;
		container.appendChild(propertiesInput);

		addLabel(container, 'Default text spacing');
		var spacingInput = document.createElement('input');
		spacingInput.type = 'number';
		spacingInput.min = '0';
		spacingInput.step = '1';
		spacingInput.style.width = '100%';
		spacingInput.value = settings.defaultSpacing;
		container.appendChild(spacingInput);

		var applyNew = addCheckbox(container, 'Apply defaults to newly inserted items', settings.applyToNewShapes);
		var keepText = addCheckbox(container, 'Keep existing non empty shape text', settings.keepExistingText);
		var buttons = document.createElement('div');
		buttons.style.marginTop = '18px';
		buttons.style.textAlign = 'right';

		function store()
		{
			parseProperties(propertiesInput.value);
			var spacing = parseInt(spacingInput.value, 10);

			if (isNaN(spacing) || spacing < 0)
			{
				throw new Error('Default text spacing must be zero or greater');
			}

			settings.defaultText = textInput.value;
			settings.defaultProperties = propertiesInput.value;
			settings.defaultSpacing = spacing;
			settings.applyToNewShapes = applyNew.checked;
			settings.keepExistingText = keepText.checked;
			saveSettings();
		}

		var apply = mxUtils.button('Apply to Selection', function()
		{
			try
			{
				store();
				applyDefaults(graph.getSelectionCells(), true);
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
				store();
				ui.hideDialog();
			}
			catch (e)
			{
				mxUtils.alert(e.message);
			}
		}));

		container.appendChild(buttons);
		ui.showDialog(container, 500, 460, true, true);
	}

	mxResources.parse(
		'pidDefaultsSettings=P&ID Defaults...' +
		'\npidApplyDefaults=Apply P&ID Defaults to Selection'
	);

	ui.actions.addAction('pidDefaultsSettings...', showSettings);
	ui.actions.addAction('pidApplyDefaults', function()
	{
		applyDefaults(graph.getSelectionCells(), true);
	});

	var extras = ui.menus.get('extras');
	var oldExtras = extras.funct;
	extras.funct = function(menu, parent)
	{
		oldExtras.apply(this, arguments);
		ui.menus.addMenuItems(menu, ['-', 'pidDefaultsSettings', 'pidApplyDefaults'], parent);
	};

	graph.addListener(mxEvent.CELLS_ADDED, function(sender, evt)
	{
		if (settings.applyToNewShapes)
		{
			applyDefaults(evt.getProperty('cells'), false);
		}
	});
});
