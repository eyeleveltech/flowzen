'use client';

import * as React from 'react';
import { Select, Option } from '@/components/ui/select';

/** ISO 4217 currency list. */
export const CURRENCIES: Option[] = [
  { value: 'INR', label: 'INR — Indian Rupee ₹' },
  { value: 'USD', label: 'USD — US Dollar $' },
  { value: 'EUR', label: 'EUR — Euro €' },
  { value: 'GBP', label: 'GBP — British Pound £' },
  { value: 'AED', label: 'AED — UAE Dirham د.إ' },
  { value: 'SGD', label: 'SGD — Singapore Dollar S$' },
  { value: 'AUD', label: 'AUD — Australian Dollar A$' },
  { value: 'CAD', label: 'CAD — Canadian Dollar C$' },
  { value: 'MYR', label: 'MYR — Malaysian Ringgit RM' },
  { value: 'LKR', label: 'LKR — Sri Lankan Rupee ₨' },
  { value: 'NPR', label: 'NPR — Nepalese Rupee ₨' },
  { value: 'BDT', label: 'BDT — Bangladeshi Taka ৳' },
  { value: 'PKR', label: 'PKR — Pakistani Rupee ₨' },
  { value: 'THB', label: 'THB — Thai Baht ฿' },
  { value: 'PHP', label: 'PHP — Philippine Peso ₱' },
  { value: 'IDR', label: 'IDR — Indonesian Rupiah Rp' },
  { value: 'VND', label: 'VND — Vietnamese Dong ₫' },
];

interface CurrencySelectProps {
  id?: string;
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Currency selection control using custom Flowzen Select.
 */
export function CurrencySelect({ id, value = 'INR', onChange, disabled, className }: CurrencySelectProps) {
  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      options={CURRENCIES}
      placeholder="Select currency..."
      disabled={disabled}
      className={className}
    />
  );
}
