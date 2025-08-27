
import React, { useState } from 'react';

const Header = ({ 
  onSearch, 
  onUndo, 
  onRedo, 
  onReset, 
  onDownloadGPX,
  undoDisabled,
  redoDisabled,
  resetDisabled,
  downloadDisabled
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
      setSearchQuery('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const scrollToSection = (sectionId) => {
    const section = document.getElementById(sectionId);
    if (section) {
      history.pushState(null, null, `#${sectionId}`);
      section.scrollIntoView({ behavior: "smooth" });
    }
    setMobileMenuOpen(false);
  };

  const returnToStartingPosition = () => {
    if (window.location.hash) {
      history.pushState(null, null, window.location.pathname + window.location.search);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleTutorial = () => {
    if (typeof window.tutorial !== "undefined" && 
        window.tutorial !== null && 
        typeof window.tutorial.startManually === "function") {
      window.tutorial.startManually();
    }
    setMobileMenuOpen(false);
  };

  return (
    <header className="header">
      <div className="logo-section">
        <h1 className="site-title" onClick={returnToStartingPosition}>
          מפת שבילי אופניים - גליל עליון וגולן
        </h1>
      </div>
      
      <button 
        className="mobile-menu-btn" 
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
      >
        <ion-icon name="menu-outline"></ion-icon>
      </button>
      
      <nav className={`nav-links ${mobileMenuOpen ? 'active' : ''}`}>
        <a 
          className="nav-link" 
          href="#trails" 
          onClick={() => scrollToSection('trails')}
        >
          שבילים
        </a>
        <a 
          className="nav-link" 
          href="#reccomendations" 
          onClick={() => scrollToSection('reccomendations')}
        >
          המלצות
        </a>
        <a 
          className="nav-link" 
          href="#contact" 
          onClick={() => scrollToSection('contact')}
        >
          צרו קשר
        </a>
        <button 
          className="nav-link help-tutorial-btn" 
          onClick={handleTutorial}
          title="הדרכה אינטראקטיבית"
        >
          מדריך
        </button>
      </nav>
      
      {/* Search and Controls */}
      <div className="search-container">
        <div className="search-input-group">
          <button id="search-btn" onClick={handleSearch}>
            <ion-icon name="search-outline"></ion-icon>
          </button>
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="ישוב/עיר, לדוגמא: דפנה" 
          />
        </div>
        
        <div className="top-controls">
          <div className="control-buttons">
            <button 
              className="control-btn" 
              onClick={onUndo}
              disabled={undoDisabled}
              title="ביטול (Ctrl+Z)"
            >
              <ion-icon name="arrow-undo-outline"></ion-icon>
            </button>
            
            <button 
              className="control-btn" 
              onClick={onRedo}
              disabled={redoDisabled}
              title="חזרה (Ctrl+Shift+Z)"
            >
              <ion-icon name="arrow-redo-outline"></ion-icon>
            </button>
            
            <button 
              className="control-btn" 
              onClick={onReset}
              disabled={resetDisabled}
              title="איפוס מסלול"
            >
              <ion-icon name="trash-outline"></ion-icon>
            </button>
            
            <button 
              className="control-btn gpx-download-button" 
              onClick={onDownloadGPX}
              disabled={downloadDisabled}
              title="סיכום, GPX, ושיתוף המסלול"
            >
              סיכום
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
