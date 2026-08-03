import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Field, FieldSelect, FieldCheckbox } from './field';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe('Field component', () => {
  it('renders label and input with value', () => {
    const onChange = vi.fn();
    render(<Field label="Company Name" value="Acme Corp" onChange={onChange} required />);
    
    expect(screen.getByLabelText(/Company Name/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme Corp')).toBeInTheDocument();
  });

  it('calls onChange when text is entered', () => {
    const onChange = vi.fn();
    render(<Field label="Contact Name" value="" onChange={onChange} />);
    
    const input = screen.getByLabelText(/Contact Name/i);
    fireEvent.change(input, { target: { value: 'John Doe' } });
    expect(onChange).toHaveBeenCalledWith('John Doe');
  });

  it('renders textarea when textarea prop is true', () => {
    const onChange = vi.fn();
    render(<Field label="Notes" textarea value="Some note" onChange={onChange} />);
    
    const textarea = screen.getByLabelText(/Notes/i);
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('displays error message when error prop is provided', () => {
    render(<Field label="Email" value="" onChange={vi.fn()} error="Email is required" />);
    
    expect(screen.getByText('Email is required')).toBeInTheDocument();
  });
});

describe('FieldSelect component', () => {
  it('renders label and options', () => {
    const onChange = vi.fn();
    render(
      <FieldSelect
        label="Source"
        value="LINKEDIN"
        onChange={onChange}
        options={[
          { label: 'LinkedIn', value: 'LINKEDIN' },
          { label: 'Referral', value: 'REFERRAL' },
        ]}
      />
    );

    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
  });

  it('renders leadingIcon inside trigger button', () => {
    render(
      <FieldSelect
        label="Priority"
        leadingIcon={<span data-testid="custom-dot">🔴</span>}
        value="HIGH"
        onChange={vi.fn()}
        options={[{ label: 'High', value: 'HIGH' }]}
      />
    );

    expect(screen.getByTestId('custom-dot')).toBeInTheDocument();
  });
});

describe('FieldCheckbox component', () => {
  it('renders label and handles check toggles', () => {
    const onChange = vi.fn();
    render(<FieldCheckbox label="Auto Renewal" checked={false} onChange={onChange} />);
    
    const checkbox = screen.getByLabelText('Auto Renewal');
    expect(checkbox).not.toBeChecked();
    
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
