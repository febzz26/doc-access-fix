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
  return;
};