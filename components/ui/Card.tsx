import React, { useRef, useState } from 'react';
import { AstrolabeSVG } from './AstrolabeSVG';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  withAstrolabe?: boolean;
}

const Card: React.FC<CardProps> = ({ children, className = '', onClick, withAstrolabe = false }) => {
  const divRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current || isFocused) return;

    const div = divRef.current;
    const rect = div.getBoundingClientRect();

    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleFocus = () => {
    setIsFocused(true);
    setOpacity(1);
  };

  const handleBlur = () => {
    setIsFocused(false);
    setOpacity(0);
  };

  const handleMouseEnter = () => {
    setOpacity(1);
  };

  const handleMouseLeave = () => {
    setOpacity(0);
  };

  return (
    <div 
      ref={divRef}
      onMouseMove={handleMouseMove}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      className={`relative bg-surface border border-stone-200 rounded-lg shadow-sm p-6 overflow-hidden transition-colors ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      <div
        className="pointer-events-none absolute -inset-px opacity-0 transition duration-300"
        style={{
          opacity,
          background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, rgba(197, 160, 89, 0.1), transparent 40%)`,
        }}
      />
      {withAstrolabe && (
        <div className="absolute -bottom-20 -right-20 w-64 h-64 text-stone-200/50 animate-spin-slow pointer-events-none">
          <AstrolabeSVG />
        </div>
      )}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
};

export default Card;