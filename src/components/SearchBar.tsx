import { useEffect, useRef, useState } from "react";

interface SearchBarProps {
  onNext: (query: string) => void;
  onPrevious: (query: string) => void;
  onClose: () => void;
}

export default function SearchBar({ onNext, onPrevious, onClose }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="searchbar" role="search">
      <input
        ref={inputRef}
        value={query}
        placeholder="Find in terminal"
        aria-label="Find in terminal"
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (query) (e.shiftKey ? onPrevious : onNext)(query);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <button type="button" title="Previous match (Shift+Enter)" aria-label="Previous match" onClick={() => query && onPrevious(query)}>
        ▲
      </button>
      <button type="button" title="Next match (Enter)" aria-label="Next match" onClick={() => query && onNext(query)}>
        ▼
      </button>
      <button type="button" title="Close (Esc)" aria-label="Close search" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
