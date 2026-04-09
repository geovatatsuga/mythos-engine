
import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300); // Wait for fade out animation
    }, 2700);
    
    return () => clearTimeout(timer);
  }, [message, type, onClose]);

  const isSuccess = type === 'success';
  const bgColor = isSuccess ? 'bg-green-600' : 'bg-red-600';
  const Icon = isSuccess ? CheckCircle : XCircle;

  return (
    <div
      className={`fixed bottom-5 right-5 flex items-center p-4 rounded-lg text-white shadow-lg transition-all duration-300 ease-in-out ${bgColor} ${visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}
      role="alert"
    >
      <Icon className="h-6 w-6 mr-3" />
      <span>{message}</span>
    </div>
  );
};

export default Toast;
