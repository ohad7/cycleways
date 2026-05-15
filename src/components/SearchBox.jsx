import React from "react";

function SearchBox({ error, onQueryChange, onSubmit, query, status }) {
  return (
    <form className="react-search" onSubmit={onSubmit}>
      <div className="react-search__row">
        <input
          aria-label="חיפוש מיקום"
          placeholder="ישוב/עיר, לדוגמא: דפנה"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <button
          className="react-button react-button--secondary"
          type="submit"
          disabled={status === "searching"}
        >
          {status === "searching" ? "מחפש" : "חיפוש"}
        </button>
      </div>
      {error && <p className="react-search__error">{error}</p>}
    </form>
  );
}

export default SearchBox;
