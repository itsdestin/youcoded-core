import React from 'react';

export interface QuickChip {
  label: string;
  prompt: string;
  needsCompletion?: boolean;
}

export const defaultChips: QuickChip[] = [
  { label: 'Journal', prompt: "let's journal" },
  { label: 'Inbox', prompt: 'check my inbox' },
  { label: 'Briefing', prompt: 'brief me on ', needsCompletion: true },
  { label: 'Draft Text', prompt: 'help me draft a text to ', needsCompletion: true },
];

interface Props {
  onChipTap: (chip: QuickChip) => void;
}

export default function QuickChips({ onChipTap }: Props) {
  return (
    <div className="flex gap-1 px-1.5 py-1.5 overflow-x-auto scrollbar-none">
      {defaultChips.map((chip) => (
        <button
          key={chip.label}
          onClick={() => onChipTap(chip)}
          className="shrink-0 h-8 px-3.5 rounded-md bg-gray-900 border border-gray-700/50 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-200 transition-colors"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
