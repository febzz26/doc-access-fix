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
    <section className="py-16 bg-accent-light">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Our Global Impact
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Making the web accessible for everyone, one document at a time
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {impactStats.map((stat, index) => {
            const IconComponent = stat.icon;
            return (
              <Card key={index} className="text-center p-6 hover:shadow-lg transition-shadow">
                <CardContent className="p-0">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg mb-4">
                    <IconComponent className="w-6 h-6 text-primary" />
                  </div>
                  <div className="text-3xl font-bold text-foreground mb-2">
                    {stat.number}
                  </div>
                  <div className="text-muted-foreground">
                    {stat.label}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};