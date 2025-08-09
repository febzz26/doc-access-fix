import React from 'react';

export const HeaderBar: React.FC = () => {
  return (
    <header className="bg-primary text-primary-foreground shadow-soft">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-accent text-accent-foreground rounded-lg flex items-center justify-center font-bold text-sm">
              DW
            </div>
            <h1 className="text-lg font-semibold">DocWise</h1>
          </div>
          <p className="text-sm opacity-90">Making documents accessible for everyone</p>
        </div>
      </div>
    </header>
  );
};