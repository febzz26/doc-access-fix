import React from 'react';

export const HeaderBar: React.FC = () => {
  return (
    <header className="bg-card border-b border-border shadow-soft">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-primary-glow text-primary-foreground rounded-lg flex items-center justify-center font-bold text-sm shadow-medium">
              DW
            </div>
            <h1 className="text-lg font-semibold text-foreground">DocWise</h1>
          </div>
          <p className="text-sm text-muted-foreground">Making documents accessible for everyone</p>
        </div>
      </div>
    </header>
  );
};