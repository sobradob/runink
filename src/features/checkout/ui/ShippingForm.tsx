import { useState } from 'react';
import { submitShipping } from '../services/checkoutApi';

interface ShippingFormProps {
  orderId: string;
  onComplete: () => void;
}

const US_STATES = [
  { code: '', name: 'Select state *' },
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'Washington DC' },
  { code: 'PR', name: 'Puerto Rico' },
];

const CA_PROVINCES = [
  { code: '', name: 'Select province *' },
  { code: 'AB', name: 'Alberta' }, { code: 'BC', name: 'British Columbia' }, { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' }, { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' }, { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' }, { code: 'ON', name: 'Ontario' }, { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' }, { code: 'SK', name: 'Saskatchewan' }, { code: 'YT', name: 'Yukon' },
];

const AU_STATES = [
  { code: '', name: 'Select state *' },
  { code: 'ACT', name: 'Australian Capital Territory' }, { code: 'NSW', name: 'New South Wales' },
  { code: 'NT', name: 'Northern Territory' }, { code: 'QLD', name: 'Queensland' },
  { code: 'SA', name: 'South Australia' }, { code: 'TAS', name: 'Tasmania' },
  { code: 'VIC', name: 'Victoria' }, { code: 'WA', name: 'Western Australia' },
];

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
  { code: 'GR', name: 'Greece' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'HU', name: 'Hungary' },
];

function getStateOptions(countryCode: string) {
  if (countryCode === 'US') return US_STATES;
  if (countryCode === 'CA') return CA_PROVINCES;
  if (countryCode === 'AU') return AU_STATES;
  return null; // free text for other countries
}

export function ShippingForm({ orderId, onComplete }: ShippingFormProps) {
  const [form, setForm] = useState({
    name: '',
    email: '',
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

  const handleCountryChange = (countryCode: string) => {
    setForm((prev) => ({ ...prev, countryCode, stateCode: '' }));
  };

  const handleSubmit = async () => {
    if (!form.name || !form.address1 || !form.city || !form.zip) {
      setError('Please fill in all required fields');
      return;
    }
    const stateOptions = getStateOptions(form.countryCode);
    if (stateOptions && !form.stateCode) {
      setError('Please select a state/province');
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

  const stateOptions = getStateOptions(form.countryCode);
  const inputClass = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30";

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-white/80 tracking-wider uppercase mb-4">
        Shipping Address
      </h3>

      <input type="text" placeholder="Full name *" value={form.name}
        onChange={(e) => update('name', e.target.value)} className={inputClass} />

      <input type="email" placeholder="Email address" value={form.email}
        onChange={(e) => update('email', e.target.value)} className={inputClass} />

      <input type="text" placeholder="Address line 1 *" value={form.address1}
        onChange={(e) => update('address1', e.target.value)} className={inputClass} />

      <input type="text" placeholder="Address line 2" value={form.address2}
        onChange={(e) => update('address2', e.target.value)} className={inputClass} />

      <div className="grid grid-cols-2 gap-2">
        <input type="text" placeholder="City *" value={form.city}
          onChange={(e) => update('city', e.target.value)} className={inputClass} />
        {stateOptions ? (
          <select value={form.stateCode} onChange={(e) => update('stateCode', e.target.value)}
            className={inputClass}>
            {stateOptions.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        ) : (
          <input type="text" placeholder="State/Province" value={form.stateCode}
            onChange={(e) => update('stateCode', e.target.value)} className={inputClass} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select value={form.countryCode} onChange={(e) => handleCountryChange(e.target.value)}
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
