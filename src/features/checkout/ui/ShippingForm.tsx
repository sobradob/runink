import { useState } from 'react';
import { submitShipping } from '../services/checkoutApi';

interface ShippingFormProps {
  orderId: string;
  onComplete: () => void;
}

export function ShippingForm({ orderId, onComplete }: ShippingFormProps) {
  const [form, setForm] = useState({
    name: '',
    address1: '',
    address2: '',
    city: '',
    stateCode: '',
    countryCode: 'US',
    zip: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const update = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!form.name || !form.address1 || !form.city || !form.zip) {
      setError('Please fill in all required fields');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await submitShipping(orderId, form);
      onComplete();
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  const COUNTRIES = [
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'ES', name: 'Spain' },
    { code: 'IT', name: 'Italy' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'AU', name: 'Australia' },
    { code: 'CA', name: 'Canada' },
    { code: 'IE', name: 'Ireland' },
    { code: 'AT', name: 'Austria' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'SE', name: 'Sweden' },
    { code: 'NO', name: 'Norway' },
    { code: 'DK', name: 'Denmark' },
    { code: 'PT', name: 'Portugal' },
    { code: 'BE', name: 'Belgium' },
    { code: 'CR', name: 'Costa Rica' },
    { code: 'HU', name: 'Hungary' },
  ];

  const inputClass = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30";

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-white/80 tracking-wider uppercase mb-4">
        Shipping Address
      </h3>

      <input type="text" placeholder="Full name *" value={form.name}
        onChange={(e) => update('name', e.target.value)} className={inputClass} />

      <input type="text" placeholder="Address line 1 *" value={form.address1}
        onChange={(e) => update('address1', e.target.value)} className={inputClass} />

      <input type="text" placeholder="Address line 2" value={form.address2}
        onChange={(e) => update('address2', e.target.value)} className={inputClass} />

      <div className="grid grid-cols-2 gap-2">
        <input type="text" placeholder="City *" value={form.city}
          onChange={(e) => update('city', e.target.value)} className={inputClass} />
        <input type="text" placeholder="State/Province" value={form.stateCode}
          onChange={(e) => update('stateCode', e.target.value)} className={inputClass} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select value={form.countryCode} onChange={(e) => update('countryCode', e.target.value)}
          className={inputClass}>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
        <input type="text" placeholder="ZIP / Postal code *" value={form.zip}
          onChange={(e) => update('zip', e.target.value)} className={inputClass} />
      </div>

      {error && <div className="text-red-400 text-xs">{error}</div>}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 disabled:opacity-50 transition-all mt-4"
      >
        {loading ? 'Submitting...' : 'Ship My Poster'}
      </button>
    </div>
  );
}
