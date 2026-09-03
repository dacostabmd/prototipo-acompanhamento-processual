'use client';

import React, { useState, Children, useRef, useLayoutEffect, type HTMLAttributes, type ReactNode } from 'react';
import { motion, AnimatePresence, type Variants } from 'motion/react';

const BLUE = '#2455b8';
const BLUE_DARK = '#17347a';
const BLUE_LIGHT = '#3b82f6';
const GOLD = '#c5a059';

export interface StepperProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  initialStep?: number;
  onStepChange?: (step: number) => void;
  onFinalStepCompleted?: () => void;
  stepCircleContainerClassName?: string;
  stepContainerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  backButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  nextButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  backButtonText?: string;
  nextButtonText?: string;
  disableStepIndicators?: boolean;
  canAdvance?: boolean;
  renderStepIndicator?: (props: {
    step: number;
    currentStep: number;
    onStepClick: (clicked: number) => void;
  }) => ReactNode;
}

export default function Stepper({
  children,
  initialStep = 1,
  onStepChange = () => {},
  onFinalStepCompleted = () => {},
  stepCircleContainerClassName = '',
  stepContainerClassName = '',
  contentClassName = '',
  footerClassName = '',
  backButtonProps = {},
  nextButtonProps = {},
  backButtonText = 'Voltar',
  nextButtonText = 'Continuar',
  disableStepIndicators = false,
  canAdvance = true,
  renderStepIndicator,
  ...rest
}: StepperProps) {
  const [currentStep, setCurrentStep] = useState<number>(initialStep);
  const [direction, setDirection] = useState<number>(0);
  const stepsArray = Children.toArray(children);
  const totalSteps = stepsArray.length;
  const isCompleted = currentStep > totalSteps;
  const isLastStep = currentStep === totalSteps;

  const updateStep = (newStep: number) => {
    setCurrentStep(newStep);
    if (newStep > totalSteps) {
      onFinalStepCompleted();
    } else {
      onStepChange(newStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setDirection(-1);
      updateStep(currentStep - 1);
    }
  };

  const handleNext = () => {
    if (!canAdvance) return;
    if (!isLastStep) {
      setDirection(1);
      updateStep(currentStep + 1);
    }
  };

  const handleComplete = () => {
    if (!canAdvance) return;
    setDirection(1);
    updateStep(totalSteps + 1);
  };

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      {...rest}
    >
      <div
        className={stepCircleContainerClassName}
        style={{
          width: '100%',
          maxWidth: 680,
          background: '#ffffff',
          borderRadius: 4,
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          border: '1px solid #e2dbce',
          overflow: 'hidden'
        }}
      >
        {/* Indicadores de Passo no topo */}
        <div
          className={stepContainerClassName}
          style={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            padding: '24px 32px 16px',
            borderBottom: '1px solid #f0eae1',
            background: '#faf8f5'
          }}
        >
          {stepsArray.map((_, index) => {
            const stepNumber = index + 1;
            const isNotLastStep = index < totalSteps - 1;
            return (
              <React.Fragment key={stepNumber}>
                {renderStepIndicator ? (
                  renderStepIndicator({
                    step: stepNumber,
                    currentStep,
                    onStepClick: clicked => {
                      if (clicked < currentStep || canAdvance) {
                        setDirection(clicked > currentStep ? 1 : -1);
                        updateStep(clicked);
                      }
                    }
                  })
                ) : (
                  <StepIndicator
                    step={stepNumber}
                    disableStepIndicators={disableStepIndicators}
                    currentStep={currentStep}
                    onClickStep={clicked => {
                      if (clicked < currentStep || canAdvance) {
                        setDirection(clicked > currentStep ? 1 : -1);
                        updateStep(clicked);
                      }
                    }}
                  />
                )}
                {isNotLastStep && <StepConnector isComplete={currentStep > stepNumber} />}
              </React.Fragment>
            );
          })}
        </div>

        {/* Conteúdo com transição deslizante */}
        <StepContentWrapper
          isCompleted={isCompleted}
          currentStep={currentStep}
          direction={direction}
          className={contentClassName}
        >
          {stepsArray[currentStep - 1]}
        </StepContentWrapper>

        {/* Rodapé com botões Voltar / Continuar */}
        {!isCompleted && (
          <div
            className={footerClassName}
            style={{
              padding: '16px 32px 24px',
              borderTop: '1px solid #f0eae1',
              background: '#faf8f5'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: currentStep !== 1 ? 'space-between' : 'flex-end',
                alignItems: 'center'
              }}
            >
              {currentStep !== 1 && (
                <button
                  type="button"
                  onClick={handleBack}
                  style={{
                    background: 'transparent',
                    border: '1px solid #d7d0c0',
                    color: '#5b6b78',
                    padding: '10px 20px',
                    fontSize: 12,
                    letterSpacing: 1,
                    cursor: 'pointer',
                    borderRadius: 2,
                    transition: 'all 0.2s ease'
                  }}
                  {...backButtonProps}
                >
                  {backButtonText}
                </button>
              )}
              <button
                type="button"
                onClick={isLastStep ? handleComplete : handleNext}
                disabled={!canAdvance}
                style={{
                  background: canAdvance ? BLUE : '#9cb4e3',
                  color: '#ffffff',
                  border: 'none',
                  padding: '12px 28px',
                  fontSize: 12,
                  letterSpacing: 1.5,
                  fontWeight: 600,
                  cursor: canAdvance ? 'pointer' : 'not-allowed',
                  borderRadius: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: canAdvance ? '0 4px 14px rgba(36,85,184,0.35)' : 'none',
                  transition: 'all 0.2s ease'
                }}
                {...nextButtonProps}
              >
                {isLastStep ? 'CONSULTAR E VERIFICAR PROCESSOS' : nextButtonText}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface StepContentWrapperProps {
  isCompleted: boolean;
  currentStep: number;
  direction: number;
  children: ReactNode;
  className?: string;
}

function StepContentWrapper({
  isCompleted,
  currentStep,
  direction,
  children,
  className = ''
}: StepContentWrapperProps) {
  const [parentHeight, setParentHeight] = useState<number>(0);

  return (
    <motion.div
      style={{ position: 'relative', overflow: 'hidden' }}
      animate={{ height: isCompleted ? 0 : parentHeight }}
      transition={{ type: 'spring', duration: 0.4 }}
      className={className}
    >
      <AnimatePresence initial={false} mode="sync" custom={direction}>
        {!isCompleted && (
          <SlideTransition key={currentStep} direction={direction} onHeightReady={h => setParentHeight(h)}>
            {children}
          </SlideTransition>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface SlideTransitionProps {
  children: ReactNode;
  direction: number;
  onHeightReady: (height: number) => void;
}

function SlideTransition({ children, direction, onHeightReady }: SlideTransitionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (containerRef.current) {
      onHeightReady(containerRef.current.offsetHeight);
    }
  }, [children, onHeightReady]);

  return (
    <motion.div
      ref={containerRef}
      custom={direction}
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.35, ease: 'easeInOut' }}
      style={{ position: 'relative', width: '100%' }}
    >
      {children}
    </motion.div>
  );
}

const stepVariants: Variants = {
  enter: (dir: number) => ({
    x: dir >= 0 ? '40%' : '-40%',
    opacity: 0
  }),
  center: {
    x: '0%',
    opacity: 1
  },
  exit: (dir: number) => ({
    x: dir >= 0 ? '-40%' : '40%',
    opacity: 0
  })
};

interface StepProps {
  children: ReactNode;
}

export function Step({ children }: StepProps) {
  return <div style={{ padding: '24px 32px' }}>{children}</div>;
}

interface StepIndicatorProps {
  step: number;
  currentStep: number;
  onClickStep: (clicked: number) => void;
  disableStepIndicators?: boolean;
}

function StepIndicator({ step, currentStep, onClickStep, disableStepIndicators = false }: StepIndicatorProps) {
  const status = currentStep === step ? 'active' : currentStep < step ? 'inactive' : 'complete';

  const handleClick = () => {
    if (step !== currentStep && !disableStepIndicators) {
      onClickStep(step);
    }
  };

  return (
    <motion.div
      onClick={handleClick}
      style={{ outline: 'none', cursor: disableStepIndicators ? 'default' : 'pointer' }}
      animate={status}
      initial={false}
    >
      <motion.div
        variants={{
          inactive: { scale: 1, backgroundColor: '#ece7de', color: '#7a8a99' },
          active: { scale: 1.08, backgroundColor: BLUE, color: '#ffffff' },
          complete: { scale: 1, backgroundColor: '#1b6b3e', color: '#ffffff' }
        }}
        transition={{ duration: 0.3 }}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 600,
          boxShadow: status === 'active' ? '0 2px 8px rgba(36,85,184,0.4)' : 'none'
        }}
      >
        {status === 'complete' ? (
          <CheckIcon style={{ width: 16, height: 16, color: '#ffffff' }} />
        ) : (
          <span>{step}</span>
        )}
      </motion.div>
    </motion.div>
  );
}

interface StepConnectorProps {
  isComplete: boolean;
}

function StepConnector({ isComplete }: StepConnectorProps) {
  const lineVariants: Variants = {
    incomplete: { width: 0, backgroundColor: 'transparent' },
    complete: { width: '100%', backgroundColor: '#1b6b3e' }
  };

  return (
    <div
      style={{
        position: 'relative',
        margin: '0 8px',
        height: 2,
        flex: 1,
        overflow: 'hidden',
        background: '#e0d8cc'
      }}
    >
      <motion.div
        style={{ position: 'absolute', left: 0, top: 0, height: '100%' }}
        variants={lineVariants}
        initial={false}
        animate={isComplete ? 'complete' : 'incomplete'}
        transition={{ duration: 0.35 }}
      />
    </div>
  );
}

interface CheckIconProps extends React.SVGProps<SVGSVGElement> {}

function CheckIcon(props: CheckIconProps) {
  return (
    <svg {...props} fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{
          delay: 0.1,
          type: 'tween',
          ease: 'easeOut',
          duration: 0.3
        }}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
