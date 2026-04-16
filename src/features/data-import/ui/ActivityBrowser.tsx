import { useState, useMemo, useCallback } from 'react';
import type { ActivitySummary } from '@/types/activity';
import { filterActivities, getUniqueLocations, suggestRegions, geocodePlace } from '../services/garminLoader';
import type { RegionFilter } from '../services/garminLoader';
import { formatDistance, formatPace, formatDate } from '@/shared/utils/format';

interface ActivityBrowserProps {
  activities: ActivitySummary[];
  onSelectSingle: (activity: ActivitySummary) => void;
  onSelectMultiple: (activities: ActivitySummary[]) => void;
}

type FilterMode = 'location' | 'region';

export function ActivityBrowser({ activities, onSelectSingle, onSelectMultiple }: ActivityBrowserProps) {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // Region filter state
  const [filterMode, setFilterMode] = useState<FilterMode>('location');
  const [region, setRegion] = useState<RegionFilter | null>(null);
  const [regionQuery, setRegionQuery] = useState('');
  const [radiusKm, setRadiusKm] = useState(20);
  const [geocoding, setGeocoding] = useState(false);

  // Activity type filter
  const [sportTypeFilter, setSportTypeFilter] = useState('Run');

  // Collapsible filters on mobile
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasActiveFilters = !!(location || region || dateFrom || dateTo);

  // Compute activity type counts for filter pills
  const sportTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of activities) {
      if (!a.hasTrack) continue;
      // Normalize similar types into display groups (case-insensitive)
      const type = (a.sportType || 'Run').toLowerCase();
      const group =
        type.includes('run') || type === 'trailrun' || type === 'virtualrun' ? 'Run' :
        type === 'walk' || type === 'hike' ? 'Walk/Hike' :
        type.includes('ride') || type.includes('bike') ? 'Ride' :
        a.sportType || 'Run';
      counts.set(group, (counts.get(group) || 0) + 1);
    }
    return counts;
  }, [activities]);

  const locations = useMemo(() => getUniqueLocations(activities), [activities]);
  const suggestedRegions = useMemo(() => suggestRegions(activities), [activities]);

  const filtered = useMemo(
    () =>
      filterActivities(activities, {
        search,
        location: filterMode === 'location' && location ? location : undefined,
        region: filterMode === 'region' && region ? { ...region, radiusKm } : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
        .filter((a) => a.hasTrack)
        .filter((a) => {
          if (sportTypeFilter === 'All') return true;
          const type = (a.sportType || 'Run').toLowerCase();
          if (sportTypeFilter === 'Run') return type.includes('run') || type === 'trailrun' || type === 'virtualrun';
          if (sportTypeFilter === 'Walk/Hike') return type === 'walk' || type === 'hike';
          if (sportTypeFilter === 'Ride') return type.includes('ride') || type.includes('bike');
          return (a.sportType || 'Run') === sportTypeFilter;
        })
        .sort((a, b) => b.timestamp - a.timestamp),
    [activities, search, location, region, radiusKm, dateFrom, dateTo, filterMode, sportTypeFilter]
  );

  const handleGeocode = useCallback(async () => {
    if (!regionQuery.trim()) return;
    setGeocoding(true);
    const result = await geocodePlace(regionQuery);
    if (result) {
      setRegion({
        centerLat: result.lat,
        centerLng: result.lng,
        radiusKm,
        label: result.name,
      });
    }
    setGeocoding(false);
  }, [regionQuery, radiusKm]);

  const handleSelectRegionSuggestion = useCallback((r: { label: string; lat: number; lng: number }) => {
    setRegion({
      centerLat: r.lat,
      centerLng: r.lng,
      radiusKm,
      label: r.label,
    });
    setRegionQuery(r.label);
  }, [radiusKm]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateCompilation = () => {
    const selected = filtered.filter((a) => selectedIds.has(a.id));
    if (selected.length > 0) onSelectMultiple(selected);
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((a) => a.id)));
  };

  // Quick compilation: select all filtered and go straight to poster
  const handleQuickCompilation = () => {
    if (filtered.length > 1) onSelectMultiple(filtered);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="p-4 border-b border-white/10 space-y-3">
        <input
          type="text"
          placeholder="Search by name or location..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
        />

        {/* Activity type pills */}
        {sportTypeCounts.size > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {['Run', 'Walk/Hike', 'Ride', 'All'].map((type) => {
              const count = type === 'All'
                ? [...sportTypeCounts.values()].reduce((a, b) => a + b, 0)
                : sportTypeCounts.get(type) || 0;
              if (type !== 'All' && count === 0) return null;
              return (
                <button
                  key={type}
                  onClick={() => setSportTypeFilter(type)}
                  className={`text-xs px-2.5 py-1.5 md:py-1 rounded-full border transition-colors ${
                    sportTypeFilter === type
                      ? 'border-white/40 bg-white/15 text-white'
                      : 'border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
                  }`}
                >
                  {type} {count > 0 && `(${count})`}
                </button>
              );
            })}
          </div>
        )}

        {/* Filters toggle (mobile only) */}
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className="md:hidden flex items-center gap-1.5 text-xs text-white/40 py-1"
        >
          <svg className={`w-3 h-3 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          Filters {hasActiveFilters && <span className="text-white/60">(active)</span>}
        </button>

        {/* Collapsible filter section — always visible on desktop, toggle on mobile */}
        <div className={`space-y-3 ${filtersOpen ? 'block' : 'hidden'} md:block`}>
          {/* Filter mode tabs */}
          <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
            <button
              onClick={() => { setFilterMode('location'); setRegion(null); }}
              className={`flex-1 text-xs py-2 md:py-1.5 rounded-md transition-colors ${
                filterMode === 'location' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'
              }`}
            >
              By Location
            </button>
            <button
              onClick={() => { setFilterMode('region'); setLocation(''); }}
              className={`flex-1 text-xs py-2 md:py-1.5 rounded-md transition-colors ${
                filterMode === 'region' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'
              }`}
            >
              By Region
            </button>
          </div>

          {/* Location dropdown */}
          {filterMode === 'location' && (
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 md:py-2 text-sm text-white focus:outline-none focus:border-white/30"
            >
              <option value="">All locations</option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          )}

          {/* Region filter */}
          {filterMode === 'region' && (
            <div className="space-y-2">
              {/* Suggested regions */}
              <div className="flex flex-wrap gap-1.5">
                {suggestedRegions.slice(0, 8).map((r) => (
                  <button
                    key={r.label}
                    onClick={() => handleSelectRegionSuggestion(r)}
                    className={`text-xs px-2.5 py-1.5 md:px-2 md:py-1 rounded-full border transition-colors ${
                      region?.label === r.label
                        ? 'border-white/40 bg-white/15 text-white'
                        : 'border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
                    }`}
                  >
                    {r.label} ({r.count})
                  </button>
                ))}
              </div>

              {/* Custom place search */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Search a place..."
                  value={regionQuery}
                  onChange={(e) => setRegionQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleGeocode()}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 md:py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
                <button
                  onClick={handleGeocode}
                  disabled={geocoding || !regionQuery.trim()}
                  className="px-3 py-2.5 md:py-2 rounded-lg bg-white/10 text-white/60 text-sm hover:bg-white/15 disabled:opacity-30 transition-colors"
                >
                  {geocoding ? '...' : 'Search'}
                </button>
              </div>

              {/* Radius slider */}
              {region && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white/40 w-12">Radius</span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={radiusKm}
                    onChange={(e) => setRadiusKm(Number(e.target.value))}
                    className="flex-1 accent-white"
                  />
                  <span className="text-xs text-white/60 w-14 text-right">{radiusKm} km</span>
                </div>
              )}

              {region && (
                <div className="text-xs text-white/30">
                  Showing runs within {radiusKm}km of {region.label}
                </div>
              )}
            </div>
          )}

          {/* Date filters */}
          <div className="flex flex-col md:flex-row gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-2.5 md:py-2 text-sm text-white focus:outline-none focus:border-white/30"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-2.5 md:py-2 text-sm text-white focus:outline-none focus:border-white/30"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <span className="text-xs text-white/40">
            {filtered.length} runs with GPS tracks
          </span>
          <div className="flex gap-2 flex-wrap">
            {/* Quick compilation button */}
            {filtered.length > 1 && !selectionMode && (
              <button
                onClick={handleQuickCompilation}
                className="text-xs px-3 py-2 md:py-1 rounded bg-white text-black font-medium hover:bg-white/90"
              >
                Compile all {filtered.length} runs
              </button>
            )}
            {selectionMode && (
              <>
                <button
                  onClick={selectAllFiltered}
                  className="text-xs px-3 py-2 md:py-1 rounded bg-white/10 text-white/60 hover:text-white"
                >
                  Select all ({filtered.length})
                </button>
                <button
                  onClick={handleCreateCompilation}
                  disabled={selectedIds.size < 2}
                  className="text-xs px-3 py-2 md:py-1 rounded bg-white text-black font-medium disabled:opacity-30"
                >
                  Create compilation ({selectedIds.size})
                </button>
              </>
            )}
            <button
              onClick={() => { setSelectionMode(!selectionMode); setSelectedIds(new Set()); }}
              className={`text-xs px-3 py-2 md:py-1 rounded ${
                selectionMode ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:text-white'
              }`}
            >
              {selectionMode ? 'Cancel' : 'Combine runs'}
            </button>
          </div>
        </div>

        {/* Multi-select explainer (mobile) */}
        {selectionMode && (
          <div className="text-xs text-white/30 bg-white/5 px-3 py-2 rounded-lg md:hidden">
            Select runs to overlay on one poster
          </div>
        )}
      </div>

      {/* Activity list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((activity) => (
          <button
            key={activity.id}
            onClick={() => {
              if (selectionMode) {
                toggleSelect(activity.id);
              } else {
                onSelectSingle(activity);
              }
            }}
            className={`w-full text-left px-4 py-4 md:py-3 border-b border-white/5 hover:bg-white/5 active:bg-white/10 transition-colors ${
              selectedIds.has(activity.id) ? 'bg-white/10' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {selectionMode && (
                  <div className={`w-6 h-6 md:w-4 md:h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                    selectedIds.has(activity.id) ? 'bg-white border-white' : 'border-white/30'
                  }`}>
                    {selectedIds.has(activity.id) && (
                      <svg className="w-4 h-4 md:w-3 md:h-3 text-black" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">{activity.name}</div>
                  <div className="text-xs text-white/40 flex items-center gap-1.5 flex-wrap">
                    <span>{formatDate(activity.date)} &middot; {activity.location}</span>
                    {activity.stravaUrl && (
                      <a
                        href={activity.stravaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[#FC5200] hover:underline font-medium"
                      >
                        Strava
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <div className="text-sm text-white/80">{formatDistance(activity.distance)}</div>
                <div className="text-xs text-white/40">{formatPace(activity.avgPace)}</div>
              </div>
            </div>
          </button>
        ))}

        {filtered.length === 0 && (
          <div className="p-8 text-center text-white/30 text-sm">
            No activities match your filters
          </div>
        )}

        {/* Strava attribution */}
        <div className="p-4 flex justify-center border-t border-white/5">
          <a href="https://www.strava.com" target="_blank" rel="noopener noreferrer">
            <img
              src="/assets/strava/powered-by-strava-white.svg"
              alt="Powered by Strava"
              className="h-6 opacity-40 hover:opacity-60 transition-opacity"
            />
          </a>
        </div>
      </div>
    </div>
  );
}
