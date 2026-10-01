Draw.loadPlugin(function(ui)
{
	var graph = ui.editor.graph;
	var rendererPrototype = mxCellRenderer.prototype;
	var svgNs = 'http://www.w3.org/2000/svg';
	var maskCounter = 0;

	if (rendererPrototype.pidEdgeLabelSpacingInstalled)
	{
		return;
	}

	rendererPrototype.pidEdgeLabelSpacingInstalled = true;

	function number(value, fallback)
	{
		value = parseFloat(value);
		return isNaN(value) ? fallback : value;
	}

	function restoreMask(shape)
	{
		if (shape == null || shape.node == null)
		{
			return;
		}

		if (shape.pidEdgeLabelSpacingPreviousMask != null)
		{
			shape.node.setAttribute('mask', shape.pidEdgeLabelSpacingPreviousMask);
		}
		else if (shape.pidEdgeLabelSpacingMask != null)
		{
			shape.node.removeAttribute('mask');
		}
	}

	function clearMask(state)
	{
		if (state == null || state.shape == null)
		{
			return;
		}

		var shape = state.shape;
		restoreMask(shape);

		if (shape.pidEdgeLabelSpacingMask != null)
		{
			var mask = shape.pidEdgeLabelSpacingMask;

			if (mask.parentNode != null)
			{
				mask.parentNode.removeChild(mask);
			}
		}

		delete shape.pidEdgeLabelSpacingMask;
		delete shape.pidEdgeLabelSpacingPreviousMask;
	}

	function getOrCreateMask(state, svg)
	{
		var shape = state.shape;
		var mask = shape.pidEdgeLabelSpacingMask;

		if (mask != null && mask.ownerSVGElement != svg)
		{
			clearMask(state);
			mask = null;
		}

		if (mask == null)
		{
			var defs = svg.querySelector('defs');

			if (defs == null)
			{
				defs = document.createElementNS(svgNs, 'defs');
				svg.insertBefore(defs, svg.firstChild);
			}

			mask = document.createElementNS(svgNs, 'mask');
			mask.setAttribute('id', 'pid-edge-label-spacing-' + (++maskCounter));
			mask.setAttribute('maskUnits', 'userSpaceOnUse');
			mask.setAttribute('maskContentUnits', 'userSpaceOnUse');

			var visible = document.createElementNS(svgNs, 'rect');
			visible.setAttribute('fill', 'white');
			visible.setAttribute('data-role', 'visible');
			mask.appendChild(visible);

			var gap = document.createElementNS(svgNs, 'rect');
			gap.setAttribute('fill', 'black');
			gap.setAttribute('data-role', 'gap');
			mask.appendChild(gap);
			defs.appendChild(mask);

			shape.pidEdgeLabelSpacingPreviousMask = shape.node.getAttribute('mask');
			shape.pidEdgeLabelSpacingMask = mask;
		}

		return mask;
	}

	function updateMask(state)
	{
		if (state == null || state.shape == null || state.text == null ||
			!state.view.graph.getModel().isEdge(state.cell))
		{
			clearMask(state);
			return;
		}

		var shapeNode = state.shape.node;
		var svg = shapeNode == null ? null : shapeNode.ownerSVGElement;

		if (svg == null)
		{
			clearMask(state);
			return;
		}

		state.text.updateBoundingBox();
		var bounds = state.text.boundingBox;

		if (bounds == null || bounds.width <= 0 || bounds.height <= 0)
		{
			clearMask(state);
			return;
		}

		var scale = state.view.scale;
		var left = number(state.text.spacingLeft, 0) * scale;
		var top = number(state.text.spacingTop, 0) * scale;
		var right = number(state.text.spacingRight, 0) * scale;
		var bottom = number(state.text.spacingBottom, 0) * scale;
		var gapX = bounds.x - left;
		var gapY = bounds.y - top;
		var gapWidth = bounds.width + left + right;
		var gapHeight = bounds.height + top + bottom;

		if (gapWidth <= 0 || gapHeight <= 0)
		{
			clearMask(state);
			return;
		}

		var mask = getOrCreateMask(state, svg);
		var visible = mask.querySelector('[data-role=visible]');
		var gap = mask.querySelector('[data-role=gap]');
		var padding = 1000;

		mask.setAttribute('x', String(state.x - padding));
		mask.setAttribute('y', String(state.y - padding));
		mask.setAttribute('width', String(Math.max(1, state.width + padding * 2)));
		mask.setAttribute('height', String(Math.max(1, state.height + padding * 2)));

		visible.setAttribute('x', String(state.x - padding));
		visible.setAttribute('y', String(state.y - padding));
		visible.setAttribute('width', String(Math.max(1, state.width + padding * 2)));
		visible.setAttribute('height', String(Math.max(1, state.height + padding * 2)));

		gap.setAttribute('x', String(gapX));
		gap.setAttribute('y', String(gapY));
		gap.setAttribute('width', String(gapWidth));
		gap.setAttribute('height', String(gapHeight));

		shapeNode.setAttribute('mask', 'url(#' + mask.getAttribute('id') + ')');
	}

	var oldRedrawLabel = rendererPrototype.redrawLabel;
	rendererPrototype.redrawLabel = function(state, forced)
	{
		oldRedrawLabel.apply(this, arguments);
		updateMask(state);
	};

	var oldDestroy = rendererPrototype.destroy;
	rendererPrototype.destroy = function(state)
	{
		clearMask(state);
		oldDestroy.apply(this, arguments);
	};

	graph.refresh();
});
