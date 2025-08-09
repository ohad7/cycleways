// Tutorial system for bike route planner
class Tutorial {
  constructor() {
    this.currentStep = 0;
    this.isActive = false;
    this.tutorialRoute = 'AQByAAcABAAFAFgAYABeAAoAeAAZAHIA';
    this.originalSegments = [];
    this.steps = [
      {
        title: 'ברוכים הבאים למפת השבילים של הגליל והגולן!',
        content: 'בואו נלמד יחד איך להשתמש במפה כדי לתכנן מסלולי רכיבה ברשת השבילים של הגליל והגולן',
        target: '.help-tutorial-btn',
        position: 'center'
      },
      {
        title: 'חיפוש מיקום',
        content: "השתמשו בשדה החיפוש כדי לנווט למקומות שונים במפה.  ",
        target: '.search-input-group',
        position: 'bottom'
      },
      {
        title: 'בחירת קטעי מסלול',
        content: 'ניתן ללחוץ על קטעי המפה כדי להוסיף אותם למסלול שלכם. הקטעים הנבחרים יוצגו בכחול כהה',
        target: '#map',
        position: 'left',
        positionMobile: 'bottom',
        highlight: 'segments'
      },
      {
        title: 'מידע על המסלול',
        content: 'כאן תוכלו לראות את המרחק הכולל, עליות וירידות, וגרף הגובה של המסלול',
        target: '.route-description-panel',
        position: 'top'
      },
      {
        title: 'הורדת קובץ GPX',
        content: 'לחצו על כפתור GPXכדי לשתף או להוריד לטלפון את המסלול ולהשתמש בו באפליקציות ניווט',
        target: '#download-gpx',
        position: 'left',
        positionMobile: 'center'
      },
      {
        title: 'זהו! אתם מוכנים  ',
        content: 'מקווים שתהנו מהמפה ורכיבה בטוחה!',
        target: null,
        position: 'center'
      }
    ];
  }

  shouldShowTutorial() {
    // Always return false to disable automatic tutorial
    // Tutorial can only be started manually via the help button
    return false;
  }

  start() {
    if (!this.shouldShowTutorial()) {
      return;
    }

    // Mark tutorial as seen
    localStorage.setItem('bikeRouteTutorialSeen', 'true');

    this.isActive = true;
    this.originalSegments = [...selectedSegments];

    // Load tutorial route
    this.loadTutorialRoute();

    // Create tutorial overlay
    this.createTutorialOverlay();

    // Show first step
    this.showStep(0);
  }

  loadTutorialRoute() {
    // Decode and load the tutorial route
    const decodedSegments = decodeRoute(this.tutorialRoute);
    if (decodedSegments.length > 0) {
      selectedSegments.length = 0;
      selectedSegments.push(...decodedSegments);

      // Wait for map to be ready and update styles
      setTimeout(() => {
        updateSegmentStyles();
        updateRouteListAndDescription();
      }, 500);
    }
  }

  createTutorialOverlay() {
    // Create dark overlay
    const overlay = document.createElement('div');
    overlay.className = 'tutorial-overlay';
    overlay.id = 'tutorial-overlay';

    // Add click listener to cancel tutorial
    overlay.addEventListener('click', () => {
      this.finish();
    });

    document.body.appendChild(overlay);

    // Create tutorial modal
    const modal = document.createElement('div');
    modal.className = 'tutorial-modal';
    modal.id = 'tutorial-modal';
    document.body.appendChild(modal);
  }

  showStep(stepIndex) {
    if (stepIndex >= this.steps.length) {
      this.finish();
      return;
    }

    this.currentStep = stepIndex;
    const step = this.steps[stepIndex];
    const modal = document.getElementById('tutorial-modal');

    if (!modal) {
      console.error('Tutorial modal not found');
      return;
    }

    // Clear previous highlights
    this.clearHighlights();

    // Update modal content
    modal.innerHTML = `
      <div class="tutorial-content">
        <div class="tutorial-header">
          <h3>${step.title}</h3>
          <div class="tutorial-progress">
            <span>${stepIndex + 1} מתוך ${this.steps.length}</span>
          </div>
        </div>
        <div class="tutorial-body">
          <p>${step.content}</p>
        </div>
        <div class="tutorial-footer">          
          ${stepIndex < this.steps.length - 1 ?
        '<button class="tutorial-btn tutorial-next">הבא</button>' :
        '<button class="tutorial-btn tutorial-done">סיום</button>'
      }
      ${stepIndex > 0 ? '<button class="tutorial-btn tutorial-prev">הקודם</button>' : ''}
          <button class="tutorial-btn tutorial-skip">דלג על המדריך</button>
        </div>
      </div>
    `;

    // Position modal
    this.positionModal(step);

    // Add highlights if needed
    console.log('Step:', step);
    if (step.highlight) {
      this.addHighlight(step);
    }

    // Add cutout if needed (but not for center-positioned steps)
    if (step.target && step.position !== 'center') {
      const target = document.querySelector(step.target);
      if (target) {
        target.classList.add('tutorial-highlight');
        this.createCutout(target);
      }
    } else if (step.target === '#map' && step.highlight === 'segments') {
      // For map with segments highlight, create cutout around route bounds
      this.createRouteBoundsCutout();
    }

    // Add event listeners
    this.addStepEventListeners(step);
  }

  positionModal(step) {
    const modal = document.getElementById('tutorial-modal');
    if (!modal) return;

    // Check if we're on mobile and step has mobile positioning
    const isMobile = window.innerWidth <= 768;
    const position = (isMobile && step.positionMobile) ? step.positionMobile : step.position;

    if (!step.target || position === 'center') {
      modal.className = 'tutorial-modal tutorial-center';
      modal.style.left = '';
      modal.style.top = '';
      modal.style.transform = '';
      return;
    }

    const target = document.querySelector(step.target);
    if (!target) {
      modal.className = 'tutorial-modal tutorial-center';
      modal.style.left = '';
      modal.style.top = '';
      modal.style.transform = '';
      return;
    }

    const targetRect = target.getBoundingClientRect();
    modal.className = `tutorial-modal tutorial-${position}`;

    // Position based on target and direction
    switch (position) {
      case 'top':
        // Position on left side for map
        modal.style.left = `${targetRect.left + targetRect.width / 2}px`;
        modal.style.top = `${targetRect.top - 20}px`;
        modal.style.transform = 'translate(-50%, -100%)';
        break;
      case 'bottom':
        // Align left edge of modal with left edge of target
        if (step.target === '#map') {
          modal.style.left = `${targetRect.left + 20}px`;
          modal.style.top = `${targetRect.bottom - 300}px`;
        } else {
          modal.style.left = `${targetRect.left}px`;
          modal.style.top = `${targetRect.bottom + 20}px`;
        }
        modal.style.transform = 'none';
        break;
      case 'left':
        modal.style.left = '30px';
        modal.style.top = `${targetRect.top + targetRect.height / 2}px`;
        modal.style.transform = 'translateY(-50%)';
        break;
      case 'right':
        modal.style.left = `${targetRect.right + 20}px`;
        modal.style.top = `${targetRect.top + targetRect.height / 2}px`;
        modal.style.transform = 'translateY(-50%)';
        break;
    }
  }

  addHighlight(step) {
    if (step.highlight === 'segments') {
      // Highlight all selected segments with a pulsing effect
      if (typeof routePolylines !== 'undefined' && typeof selectedSegments !== 'undefined' && typeof map !== 'undefined') {
        routePolylines.forEach(polylineData => {
          if (selectedSegments.includes(polylineData.segmentName)) {
            const layerId = polylineData.layerId;
            if (map.getLayer && map.getLayer(layerId)) {
              map.setPaintProperty(layerId, 'line-color', '#ffffff');
              map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight + 3);
            }
          }
        });

        // Animate the highlight
        let pulseCount = 0;
        const pulseInterval = setInterval(() => {
          routePolylines.forEach(polylineData => {
            if (selectedSegments.includes(polylineData.segmentName)) {
              const layerId = polylineData.layerId;
              if (map.getLayer && map.getLayer(layerId)) {
                const isHighlighted = pulseCount % 2 === 0;
                map.setPaintProperty(layerId, 'line-color', isHighlighted ? '#ffffff' : '#006699');
              }
            }
          });
          pulseCount++;

          if (pulseCount >= 6) {
            clearInterval(pulseInterval);
            // Reset to normal selection style
            if (typeof updateSegmentStyles === 'function') {
              updateSegmentStyles();
            }
          }
        }, 500);
      }
    }

    // Note: cutout creation is now handled in showStep method
  }

  createCutout(element) {
    const overlay = document.getElementById('tutorial-overlay');
    console.log(overlay);
    if (!overlay || !element) return;
    console.log('Made it through');

    // Add cutout class to overlay
    overlay.classList.add('has-cutout');

    const rect = element.getBoundingClientRect();
    const padding = 8;

    // Calculate the cutout area
    const cutoutLeft = rect.left - padding;
    const cutoutTop = rect.top - padding;
    const cutoutRight = rect.right + padding;
    const cutoutBottom = rect.bottom + padding;

    // Create four overlay rectangles to surround the cutout area
    const rectangles = [
      // Top rectangle
      {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: cutoutTop
      },
      // Bottom rectangle
      {
        left: 0,
        top: cutoutBottom,
        width: window.innerWidth,
        height: window.innerHeight - cutoutBottom
      },
      // Left rectangle
      {
        left: 0,
        top: cutoutTop,
        width: cutoutLeft,
        height: cutoutBottom - cutoutTop
      },
      // Right rectangle
      {
        left: cutoutRight,
        top: cutoutTop,
        width: window.innerWidth - cutoutRight,
        height: cutoutBottom - cutoutTop
      }
    ];

    // Create and position the overlay rectangles
    rectangles.forEach((rectData, index) => {
      if (rectData.width > 0 && rectData.height > 0) {
        const overlayRect = document.createElement('div');
        overlayRect.className = 'tutorial-overlay-rect';
        overlayRect.id = `tutorial-overlay-rect-${index}`;

        overlayRect.style.left = `${rectData.left}px`;
        overlayRect.style.top = `${rectData.top}px`;
        overlayRect.style.width = `${rectData.width}px`;
        overlayRect.style.height = `${rectData.height}px`;

        document.body.appendChild(overlayRect);
      }
    });

    // Create the highlight border around the cutout
    const cutout = document.createElement('div');
    cutout.className = 'tutorial-cutout';
    cutout.id = 'tutorial-cutout';

    cutout.style.left = `${cutoutLeft}px`;
    cutout.style.top = `${cutoutTop}px`;
    cutout.style.width = `${rect.width + (padding * 2)}px`;
    cutout.style.height = `${rect.height + (padding * 2)}px`;

    document.body.appendChild(cutout);

    // Ensure the target element appears above everything
    element.style.zIndex = '10002';
  }

  createRouteBoundsCutout() {
    // This method used to do something special, now it's just a wrapper for createCutout
    const target = document.querySelector('#map');
    if (target) {
      this.createCutout(target);
    }

    const overlay = document.getElementById('tutorial-overlay');
    if (!overlay) return;

    overlay.classList.add('has-cutout');
  }

  clearHighlights() {
    // Remove tutorial highlight class from all elements and reset z-index
    document.querySelectorAll('.tutorial-highlight').forEach(el => {
      el.classList.remove('tutorial-highlight');
      el.style.position = '';
      el.style.zIndex = '';
    });

    // Remove cutout overlay
    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) {
      overlay.classList.remove('has-cutout');
    }

    // Remove all overlay rectangles
    document.querySelectorAll('.tutorial-overlay-rect').forEach(rect => {
      rect.remove();
    });

    // Remove cutout element
    const cutout = document.getElementById('tutorial-cutout');
    if (cutout) {
      cutout.remove();
    }
  }

  addStepEventListeners(step) {
    const modal = document.getElementById('tutorial-modal');

    // Next button
    const nextBtn = modal.querySelector('.tutorial-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.showStep(this.currentStep + 1);
      });
    }

    // Previous button
    const prevBtn = modal.querySelector('.tutorial-prev');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.showStep(this.currentStep - 1);
      });
    }

    // Done button
    const doneBtn = modal.querySelector('.tutorial-done');
    if (doneBtn) {
      doneBtn.addEventListener('click', () => {
        this.finish();
      });
    }

    // Skip button
    const skipBtn = modal.querySelector('.tutorial-skip');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        this.finish();
      });
    }

    // Special actions for specific steps
    if (step.action === 'hover-elevation') {
      // Simulate elevation hover
      setTimeout(() => {
        const elevationChart = document.querySelector('.elevation-chart');
        if (elevationChart) {
          // Create a fake hover event to show the elevation marker
          const event = new MouseEvent('mousemove', {
            clientX: elevationChart.getBoundingClientRect().left + elevationChart.getBoundingClientRect().width / 2,
            clientY: elevationChart.getBoundingClientRect().top + elevationChart.getBoundingClientRect().height / 2
          });

          const overlay = elevationChart.querySelector('.elevation-hover-overlay');
          if (overlay) {
            overlay.dispatchEvent(event);
          }
        }
      }, 1000);
    }
  }

  finish() {
    this.isActive = false;

    // Clear tutorial route and restore original route
    if (typeof selectedSegments !== 'undefined') {
      selectedSegments.length = 0;
      selectedSegments.push(...this.originalSegments);

      if (typeof updateSegmentStyles === 'function') {
        updateSegmentStyles();
      }
      if (typeof updateRouteListAndDescription === 'function') {
        updateRouteListAndDescription();
      }
    }

    // Clear highlights
    this.clearHighlights();

    // Remove all overlay rectangles
    document.querySelectorAll('.tutorial-overlay-rect').forEach(rect => {
      rect.remove();
    });

    // Remove tutorial overlay
    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) {
      overlay.remove();
    }

    // Remove tutorial modal
    const modal = document.getElementById('tutorial-modal');
    if (modal) {
      modal.remove();
    }

    // Remove elevation marker if it exists
    if (window.elevationMarker) {
      window.elevationMarker.remove();
      window.elevationMarker = null;
    }
  }

  startManually() {
    if (this.isActive) {
      return; // Already running
    }

    // Close mobile menu if it's open
    const navLinks = document.getElementById('nav-links');
    if (navLinks && navLinks.classList.contains('active')) {
      navLinks.classList.remove('active');

      // Also restore z-index for search and legend containers
      const searchContainer = document.querySelector('.search-container');
      const legendContainer = document.querySelector('.legend-container');

      if (searchContainer && searchContainer.dataset.originalZIndex) {
        if (searchContainer.dataset.originalZIndex === 'auto') {
          searchContainer.style.zIndex = '';
        } else {
          searchContainer.style.zIndex = searchContainer.dataset.originalZIndex;
        }
        delete searchContainer.dataset.originalZIndex;
      }
      if (legendContainer && legendContainer.dataset.originalZIndex) {
        if (legendContainer.dataset.originalZIndex === 'auto') {
          legendContainer.style.zIndex = '';
        } else {
          legendContainer.style.zIndex = legendContainer.dataset.originalZIndex;
        }
        delete legendContainer.dataset.originalZIndex;
      }
    }

    // Save current route
    this.originalSegments = [...selectedSegments];

    // Load tutorial route
    const decodedSegments = decodeRoute(this.tutorialRoute);
    if (decodedSegments.length > 0) {
      selectedSegments.length = 0;
      selectedSegments.push(...decodedSegments);
      updateSegmentStyles();
      updateRouteListAndDescription();
    }

    // Remove any existing tutorial elements
    const existingOverlay = document.getElementById('tutorial-overlay');
    const existingModal = document.getElementById('tutorial-modal');

    if (existingOverlay) existingOverlay.remove();
    if (existingModal) existingModal.remove();

    // Remove elevation marker if it exists
    if (window.elevationMarker) {
      window.elevationMarker.remove();
      window.elevationMarker = null;
    }

    // Clear any highlights
    this.clearHighlights();

    // Start tutorial
    this.isActive = true;
    this.currentStep = 0;

    // Create tutorial overlay and modal
    this.createTutorialOverlay();

    // Show first step
    this.showStep(0);
  }

  // Method to reset tutorial (for testing purposes)
  static reset() {
    localStorage.removeItem('bikeRouteTutorialSeen');
  }
}

// Initialize tutorial when DOM is ready
let tutorial = null;

function initTutorial() {
  tutorial = new Tutorial();

  // Start tutorial after map is loaded and ready
  setTimeout(() => {
    if (tutorial.shouldShowTutorial()) {
      tutorial.start();
    }
  }, 2000); // Wait for map and data to load
}

// Export for global access
window.Tutorial = Tutorial;
window.initTutorial = initTutorial;