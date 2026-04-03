import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className = '',
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-semibold rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed tracking-wide';

  const variantStyles = {
    primary: 'bg-primary text-white hover:bg-primary-hover focus:ring-primary shadow-md shadow-primary/20',
    secondary: 'bg-secondary text-white hover:bg-secondary-hover focus:ring-secondary shadow-md shadow-secondary/20',
    ghost: 'bg-transparent text-text-secondary hover:bg-paper hover:text-primary border border-transparent hover:border-stone-200',
  };

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs uppercase',
    md: 'px-5 py-2.5 text-sm uppercase',
    lg: 'px-8 py-3 text-base uppercase',
  };

  const loadingSpinner = (
    <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-currentColor" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading && loadingSpinner}
      {children}
    </button>
  );
};

export default Button;