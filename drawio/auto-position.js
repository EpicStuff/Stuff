Draw.loadPlugin(function(ui)
{
	var graph = ui.editor.graph;
	var model = graph.getModel();
	var refreshing = false;
	var refreshTimer = null;
	var dropdownTimer = null;
	var autoStyleKey = 'pidAutoTextPosition';
	var autoOptionValue = 'pidAutoPosition';
	var priority = [
		'bottom',
		'top',
		'left',
		'right',
		'bottomLeft',
		'bottomRight',
		'topLeft',
		'topRight'
	];
	var positions = {
		bottom: ['center', 'bottom', 'center', 'top'],
		top: ['center', 'top', 'center', 'bottom'],
		left: ['left', 'middle', 'right', 'middle'],
		right: ['right', 'middle', 'left', 'middle'],
		bottomLeft: ['left', 'bottom', 'right', 'top'],
		bottomRight: ['right', 'bottom', 'left', 'top'],
		topLeft: ['left', 'top', 'right', 'bottom'],
		topRight: ['right', 'top', 'left', 'bottom']
	};

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

	function isAuto(cell)
	{
		return mxUtils.getValue(graph.getCellStyle(cell), autoStyleKey, 1) == 1;
	}

	function setAuto(cells, enabled)
	{
		var vertices = getVertices(cells);
		model.beginUpdate();

		try
		{
			for (var i = 0; i < vertices.length; i++)
			{
				var style = model.getStyle(vertices[i]) || '';
				model.setStyle(vertices[i], mxUtils.setStyle(style, autoStyleKey, enabled ? '1' : '0'));
			}
		}
		finally
		{
			model.endUpdate();
		}

		if (enabled)
		{
			scheduleRefresh();
		}
	}

	function cellCenter(cell)
	{
		var state = graph.view.getState(cell);

		if (state == null)
		{
			return null;
		}

		return new mxPoint(
			state.x + state.width / 2,
			state.y + state.height / 2
		);
	}

	function classifyDirection(state, point, fallback)
	{
		var cx = state.x + state.width / 2;
		var cy = state.y + state.height / 2;
		var dx;
		var dy;

		if (point != null)
		{
			dx = (point.x - cx) / Math.max(state.width / 2, 1);
			dy = (point.y - cy) / Math.max(state.height / 2, 1);
		}
		else if (fallback != null)
		{
			dx = fallback.x - cx;
			dy = fallback.y - cy;
			var scale = Math.max(Math.abs(dx), Math.abs(dy), 1);
			dx /= scale;
			dy /= scale;
		}
		else
		{
			return null;
		}

		var ax = Math.abs(dx);
		var ay = Math.abs(dy);

		if (ax < ay * 0.5)
		{
			return dy >= 0 ? 'bottom' : 'top';
		}

		if (ay < ax * 0.5)
		{
			return dx >= 0 ? 'right' : 'left';
		}

		if (dy >= 0)
		{
			return dx >= 0 ? 'bottomRight' : 'bottomLeft';
		}

		return dx >= 0 ? 'topRight' : 'topLeft';
	}

	function getBlockedDirections(cell)
	{
		var blocked = {};
		var state = graph.view.getState(cell);

		if (state == null)
		{
			return blocked;
		}

		var edges = graph.getEdges(cell);

		for (var i = 0; i < edges.length; i++)
		{
			var edge = edges[i];
			var edgeState = graph.view.getState(edge);
			var source = model.getTerminal(edge, true);
			var target = model.getTerminal(edge, false);
			var point = null;
			var other = null;

			if (source == cell)
			{
				if (edgeState != null && edgeState.absolutePoints != null)
				{
					point = edgeState.absolutePoints[0];
				}

				other = target;
			}
			else if (target == cell)
			{
				if (edgeState != null && edgeState.absolutePoints != null)
				{
					point = edgeState.absolutePoints[edgeState.absolutePoints.length - 1];
				}

				other = source;
			}

			var direction = classifyDirection(state, point, other == null ? null : cellCenter(other));

			if (direction != null)
			{
				blocked[direction] = true;
			}
		}

		return blocked;
	}

	function choosePosition(cell)
	{
		var blocked = getBlockedDirections(cell);

		for (var i = 0; i < priority.length; i++)
		{
			if (!blocked[priority[i]])
			{
				return priority[i];
			}
		}

		return 'bottom';
	}

	function applyPosition(cell, name)
	{
		var values = positions[name];
		var oldStyle = model.getStyle(cell) || '';
		var newStyle = oldStyle;

		newStyle = mxUtils.setStyle(newStyle, mxConstants.STYLE_LABEL_POSITION, values[0]);
		newStyle = mxUtils.setStyle(newStyle, mxConstants.STYLE_VERTICAL_LABEL_POSITION, values[1]);
		newStyle = mxUtils.setStyle(newStyle, mxConstants.STYLE_ALIGN, values[2]);
		newStyle = mxUtils.setStyle(newStyle, mxConstants.STYLE_VERTICAL_ALIGN, values[3]);

		if (newStyle != oldStyle)
		{
			model.setStyle(cell, newStyle);
		}
	}

	function refreshPositions()
	{
		if (refreshing)
		{
			return;
		}

		refreshing = true;
		graph.view.validate();
		var vertices = getVertices(model.getDescendants(model.getRoot()));
		model.beginUpdate();

		try
		{
			for (var i = 0; i < vertices.length; i++)
			{
				if (isAuto(vertices[i]))
				{
					applyPosition(vertices[i], choosePosition(vertices[i]));
				}
			}
		}
		finally
		{
			model.endUpdate();
			refreshing = false;
		}

		scheduleDropdownSync();
	}

	function scheduleRefresh()
	{
		if (refreshTimer == null)
		{
			refreshTimer = window.setTimeout(function()
			{
				refreshTimer = null;
				refreshPositions();
			}, 0);
		}
	}

	function isPositionSelect(select)
	{
		var values = {};

		for (var i = 0; i < select.options.length; i++)
		{
			values[select.options[i].value] = true;
		}

		return values.topLeft === true && values.center === true && values.bottomRight === true;
	}

	function syncDropdowns()
	{
		dropdownTimer = null;
		var selected = getVertices(graph.getSelectionCells());

		if (selected.length == 0)
		{
			return;
		}

		for (var i = 0; i < selected.length; i++)
		{
			if (!isAuto(selected[i]))
			{
				return;
			}
		}

		var selects = document.getElementsByTagName('select');

		for (var j = 0; j < selects.length; j++)
		{
			if (isPositionSelect(selects[j]))
			{
				selects[j].value = autoOptionValue;
			}
		}
	}

	function scheduleDropdownSync()
	{
		if (dropdownTimer == null)
		{
			dropdownTimer = window.setTimeout(syncDropdowns, 0);
		}
	}

	if (typeof TextFormatPanel !== 'undefined' && TextFormatPanel.prototype.addFont != null)
	{
		var oldAddFont = TextFormatPanel.prototype.addFont;

		TextFormatPanel.prototype.addFont = function(container)
		{
			var result = oldAddFont.apply(this, arguments);
			var selects = container.getElementsByTagName('select');

			for (var i = 0; i < selects.length; i++)
			{
				var select = selects[i];

				if (!isPositionSelect(select))
				{
					continue;
				}

				var found = false;

				for (var j = 0; j < select.options.length; j++)
				{
					found = found || select.options[j].value == autoOptionValue;
				}

				if (!found)
				{
					var option = document.createElement('option');
					option.value = autoOptionValue;
					mxUtils.write(option, 'Auto');
					select.insertBefore(option, select.firstChild);
				}

				mxEvent.addListener(select, 'change', function()
				{
					setAuto(graph.getSelectionCells(), this.value == autoOptionValue);
					scheduleDropdownSync();
				});
			}

			scheduleDropdownSync();
			return result;
		};
	}

	graph.addListener(mxEvent.CELL_CONNECTED, scheduleRefresh);
	graph.addListener(mxEvent.CELLS_ADDED, scheduleRefresh);
	graph.addListener(mxEvent.CELLS_REMOVED, scheduleRefresh);
	graph.addListener(mxEvent.CELLS_MOVED, scheduleRefresh);
	graph.addListener(mxEvent.CELLS_RESIZED, scheduleRefresh);
	graph.addListener('cellsArranged', scheduleRefresh);
	graph.selectionModel.addListener(mxEvent.CHANGE, scheduleDropdownSync);
	ui.addListener('styleChanged', scheduleDropdownSync);

	if (graph.connectionHandler != null)
	{
		graph.connectionHandler.addListener(mxEvent.CONNECT, scheduleRefresh);
	}

	scheduleRefresh();
});
