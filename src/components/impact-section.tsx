import React from 'react';
import { Users, Globe, FileCheck, Heart } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
export const ImpactSection: React.FC = () => {
  const impactStats = [{
    icon: Users,
    number: '2.1M+',
    label: 'Documents Made Accessible'
  }, {
    icon: Globe,
    number: '140+',
    label: 'Countries Served'
  }, {
    icon: FileCheck,
    number: '99.8%',
    label: 'Success Rate'
  }, {
    icon: Heart,
    number: '1.3M+',
    label: 'Lives Improved'
  }];
  
  return (
    <section className="py-16 bg-background">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {impactStats.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <Card key={index} className="text-center">
                <CardContent className="p-6">
                  <Icon className="w-8 h-8 mx-auto mb-4 text-primary" />
                  <div className="text-2xl font-bold text-foreground mb-2">{stat.number}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};