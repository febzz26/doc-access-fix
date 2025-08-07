import React from 'react';
import { HeroSection } from '@/components/hero-section';
import { ProblemSolutionSection } from '@/components/problem-solution';
import { FeaturesSection } from '@/components/features-section';
import { ImpactSection } from '@/components/impact-section';
import { Footer } from '@/components/footer';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <HeroSection />
      <ProblemSolutionSection />
      <FeaturesSection />
      <ImpactSection />
      <Footer />
    </div>
  );
};

export default Index;
