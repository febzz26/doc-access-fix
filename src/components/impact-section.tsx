import React from 'react';
import { Users, Globe, FileCheck, Heart } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export const ImpactSection: React.FC = () => {
  const impactStats = [
    { icon: Users, number: '2.1M+', label: 'Documents Made Accessible' },
    { icon: Globe, number: '140+', label: 'Countries Served' },
    { icon: FileCheck, number: '99.8%', label: 'Success Rate' },
    { icon: Heart, number: '1.3M+', label: 'Lives Improved' },
  ];

  return (
    <section className="container mx-auto px-4 py-16">
      <header className="mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground">Our Impact</h2>
        <p className="text-muted-foreground mt-2">
          Helping organizations and individuals make information accessible for everyone.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {impactStats.map(({ icon: Icon, number, label }, i) => (
          <Card key={i} className="bg-card border">
            <CardContent className="p-5 flex items-center gap-3">
              <Icon className="w-5 h-5 text-primary" />
              <div>
                <div className="text-xl font-semibold text-foreground">{number}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
};