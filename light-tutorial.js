
// Light Tutorial system for showing example interactions
class LightTutorial {
  constructor(map) {
    this.map = map;
    this.exampleMarker = null;
    this.tooltip = null;
    this.arrow = null;
    this.updatePositionHandler = null;
    this.removeTimeout = null;
  }

  // Create and show example point marker
  showExamplePoint(lat, lng, duration = 3000) {
    // Don't show if user already has segments selected or if main tutorial is active
    if (
      selectedSegments.length > 0 ||
      (window.tutorial && window.tutorial.isActive)
    ) {
      return;
    }

    this.clearAll(); // Clear any existing elements

    // Create example point marker
    const exampleElement = document.createElement("div");
    exampleElement.className = "example-point";
    exampleElement.style.cssText = `
      width: 12px;
      height: 12px;
      background: #ff4444;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(255, 68, 68, 0.6);
      cursor: pointer;
      animation: pulse 1.5s infinite;
      display: none;
    `;

    this.exampleMarker = new mapboxgl.Marker(exampleElement)
      .setLngLat([lng, lat])
      .addTo(this.map);

    // Auto-remove after duration
    if (duration > 0) {
      this.removeTimeout = setTimeout(() => {
        this.clearAll();
      }, duration);
    }

    return exampleElement;
  }

  // Create and show tooltip
  showTooltip(text, offsetX = -90, offsetY = -18) {
    if (!this.exampleMarker) return null;

    // Create tooltip
    this.tooltip = document.createElement("div");
    this.tooltip.className = "example-tooltip";
    this.tooltip.innerHTML = text;
    this.tooltip.style.cssText = `
      position: absolute;
      background: white;
      color: black;
      font-weight: bold;
      padding: 4px 6px;
      border: 2px solid red;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      animation: tooltipBounce 1s ease-in-out infinite alternate;
      display: none;
    `;

    document.body.appendChild(this.tooltip);

    // Position tooltip
    this.updateTooltipPosition(offsetX, offsetY);
    this.tooltip.style.display = "";

    return this.tooltip;
  }

  // Create and show arrow
  showArrow(offsetX = -24, offsetY = -50, rotation = -20) {
    if (!this.exampleMarker) return null;

    // Create arrow
    this.arrow = document.createElement("div");
    this.arrow.className = "example-arrow";
    this.arrow.style.cssText = `
      position: absolute;
      width: 32px;
      height: 32px;
      z-index: 999;
      pointer-events: none;
      filter: drop-shadow(0 0 2px white);
      transform: rotate(${rotation}deg);
      animation: tooltipBounce 1s ease-in-out infinite alternate;
      display: none;
    `;

    document.body.appendChild(this.arrow);

    // Load arrow SVG and position
    return fetch("arrow.svg")
      .then((response) => response.text())
      .then((svgContent) => {
        this.arrow.innerHTML = svgContent;
        this.updateArrowPosition(offsetX, offsetY);
        this.arrow.style.display = "";
        return this.arrow;
      })
      .catch((error) => {
        console.warn("Could not load arrow SVG:", error);
        // Fallback to text arrow
        this.arrow.innerHTML = "↓";
        this.arrow.style.fontSize = "24px";
        this.arrow.style.color = "#ff4444";
        this.updateArrowPosition(offsetX, offsetY);
        this.arrow.style.display = "";
        return this.arrow;
      });
  }

  // Show complete example (point + tooltip + arrow)
  showCompleteExample(lat, lng, tooltipText = "לחץ להוספה <br>למסלול", duration = 3000) {
    const exampleElement = this.showExamplePoint(lat, lng, duration);
    if (!exampleElement) return;

    this.showTooltip(tooltipText);
    
    this.showArrow().then(() => {
      // Show the example point after arrow is loaded
      exampleElement.style.display = "";
      
      // Set up position update handler
      this.setupPositionUpdates();
    });
  }

  // Update tooltip position relative to marker
  updateTooltipPosition(offsetX = -90, offsetY = -18) {
    if (!this.tooltip || !this.exampleMarker) return;

    const exampleElement = this.exampleMarker.getElement();
    const rect = exampleElement.getBoundingClientRect();

    this.tooltip.style.left = rect.left + offsetX + "px";
    this.tooltip.style.top = rect.top + offsetY + "px";
  }

  // Update arrow position relative to marker
  updateArrowPosition(offsetX = -24, offsetY = -50) {
    if (!this.arrow || !this.exampleMarker) return;

    const exampleElement = this.exampleMarker.getElement();
    const rect = exampleElement.getBoundingClientRect();

    this.arrow.style.left = rect.left + offsetX + "px";
    this.arrow.style.top = rect.top + offsetY + "px";
  }

  // Set up position updates when map moves
  setupPositionUpdates() {
    if (this.updatePositionHandler) {
      this.map.off("move", this.updatePositionHandler);
    }

    this.updatePositionHandler = () => {
      if (this.tooltip && this.tooltip.style.display !== "none") {
        this.updateTooltipPosition();
      }
      if (this.arrow && this.arrow.style.display !== "none") {
        this.updateArrowPosition();
      }
    };

    this.map.on("move", this.updatePositionHandler);
  }

  // Clear all tutorial elements
  clearAll() {
    // Clear timeout
    if (this.removeTimeout) {
      clearTimeout(this.removeTimeout);
      this.removeTimeout = null;
    }

    // Remove map event handler
    if (this.updatePositionHandler) {
      this.map.off("move", this.updatePositionHandler);
      this.updatePositionHandler = null;
    }

    // Remove marker
    if (this.exampleMarker) {
      this.exampleMarker.remove();
      this.exampleMarker = null;
    }

    // Remove tooltip
    if (this.tooltip && this.tooltip.parentNode) {
      this.tooltip.parentNode.removeChild(this.tooltip);
      this.tooltip = null;
    }

    // Remove arrow
    if (this.arrow && this.arrow.parentNode) {
      this.arrow.parentNode.removeChild(this.arrow);
      this.arrow = null;
    }
  }

  // Show the default example point (as used in the original function)
  showDefaultExample() {
    const exampleLat = 33.19692644679666;
    const exampleLng = 35.58858972227379;
    
    this.showCompleteExample(exampleLat, exampleLng, "לחץ להוספה <br>למסלול", 3000);
  }
}

// Export for global access
window.LightTutorial = LightTutorial;
