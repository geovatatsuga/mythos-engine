import React from 'react';
import { CircleHelp } from 'lucide-react';
import Tooltip from './Tooltip';

interface InlineHelpProps {
  content: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const InlineHelp: React.FC<InlineHelpProps> = ({ content, position = 'top', className }) => (
  <Tooltip content={content} position={position} className={className}>
    <button
      type="button"
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition-colors hover:text-stone-700"
      aria-label="Help"
      onClick={event => event.preventDefault()}
    >
      <CircleHelp className="h-3.5 w-3.5" />
    </button>
  </Tooltip>
);

export default InlineHelp;
