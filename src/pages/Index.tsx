import React from 'react';
import { Navigation } from '@/components/navigation';
import { HeroSection } from '@/components/hero-section';
import { ProblemSolutionSection } from '@/components/problem-solution';
import { FeaturesSection } from '@/components/features-section';
import { Footer } from '@/components/footer';

const Index = () => {
  return (
    <div className="min-h-screen animated-gradient">
      <Navigation />
      <main className="pt-16 space-y-16 sm:space-y-24">
        <HeroSection />
        <ProblemSolutionSection />
        <FeaturesSection />
        <Footer />
      </main>
    </div>
  );
};

export default Index;
