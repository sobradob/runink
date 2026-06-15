import { useState, useMemo, useCallback, useRef } from 'react';
import type { ActivitySummary } from '@/types/activity';
import type { OutputMode } from '@/features/onboarding/services/outputMode';
import { filterActivities, getUniqueLocations, suggestRegions, geocodePlace } from '../services/garminLoader';
import type { RegionFilter } from '../services/garminLoader';
import { rankHeroRuns, isRace, DISTANCE_BANDS, matchesDistanceBand } from '../services/heroRuns';
import { formatDistance, formatPace, formatDate } from '@/shared/utils/format';
import { boundsFromActivities, distanceKm } from '@/shared/geo/bounds';
import { DispersedCompileModal } from './DispersedCompileModal';

/** Diagonal (km) above which a composite prompts before proceeding.
 *  ~300 km is roughly "multiple cities"; tight regional collections
 *  (Budapest, Greater London, etc.) fall under this threshold. */
const DISPERSED_THRESHOLD_KM = 300;

interface ActivityBrowserProps {
  activities: ActivitySummary[];
  /** Which output the user is building — drives the entire browse UI. */
  outputMode: OutputMode;
  /** True while older activities are still streaming in from Strava. */
  syncingMore?: boolean;
  /** Total activities loaded so far (for the live composite indicator). */
  loadedCount?: number;
  onSelectSingle: (activity: ActivitySummary) => void;
  onSelectMultiple: (activities: ActivitySummary[]) => void;
}

type FilterMode = 'location' | 'region';

export function ActivityBrowser({
  activities,
  outputMode,
  syncingMore,
  onSelectSingle,
  onSelectMultiple,
}: ActivityBrowserProps) {
  const isComposite = outputMode === 'composite';

  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Region filter state (composite only)
  const [filterMode, setFilterMode] = useState<FilterMode>('region');
  const [region, setRegion] = useState<RegionFilter | null>(null);
  const [regionQuery, setRegionQuery] = useState('');
  const [radiusKm, setRadiusKm] = useState(20);
  const [geocoding, setGeocoding] = useState(false);

  // Activity type filter (both modes)
  const [sportTypeFilter, setSportTypeFilter] = useState('Run');
  // Distance band filter (single only)
  const [distanceBand, setDistanceBand] = useState<string | null>(null);

  // Composite: runs are auto-included; tapping a run excludes it (refinement).
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  // Collapsible filters on mobile
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasActiveFilters = !!(location || region || dateFrom || dateTo || distanceBand);

  const [dispersionWarn, setDispersionWarn] = useState(false);
  const filtersSectionRef = useRef<HTMLDivElement>(null);

  // Activity type counts for filter pills
  const sportTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of activities) {
      if (!a.hasTrack) continue;
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

  // Shared filter pipeline. Region/distance-band only apply in their mode.
  const filtered = useMemo(
    () =>
      filterActivities(activities, {
        search,
        location: !isComposite ? undefined : (filterMode === 'location' && location ? location : undefined),
        region: isComposite && filterMode === 'region' && region ? { ...region, radiusKm } : undefined,
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
        .filter((a) => (isComposite ? true : matchesDistanceBand(a, distanceBand)))
        .sort((a, b) => b.timestamp - a.timestamp),
    [activities, search, location, region, radiusKm, dateFrom, dateTo, filterMode, sportTypeFilter, distanceBand, isComposite]
  );

  // Single mode: a handful of poster-worthy runs surfaced above the list.
  const heroRuns = useMemo(
    () => (isComposite ? [] : rankHeroRuns(filtered, 4)),
    [filtered, isComposite]
  );
  const heroIds = useMemo(() => new Set(heroRuns.map((a) => a.id)), [heroRuns]);

  // Composite: included = filtered minus user-excluded.
  const included = useMemo(
    () => (isComposite ? filtered.filter((a) => !excludedIds.has(a.id)) : filtered),
    [isComposite, filtered, excludedIds]
  );

  const handleGeocode = useCallback(async () => {
    if (!regionQuery.trim()) return;
    setGeocoding(true);
    const result = await geocodePlace(regionQuery);
    if (result) {
      setRegion({ centerLat: result.lat, centerLng: result.lng, radiusKm, label: result.name });
    }
    setGeocoding(false);
  }, [regionQuery, radiusKm]);

  const handleSelectRegionSuggestion = useCallback((r: { label: string; lat: number; lng: number }) => {
    setRegion({ centerLat: r.lat, centerLng: r.lng, radiusKm, label: r.label });
    setRegionQuery(r.label);
  }, [radiusKm]);

  const toggleExclude = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Dispersion stats for the composite set.
  const { diagonalKm, isDispersed } = useMemo(() => {
    if (included.length < 2) return { diagonalKm: 0, isDispersed: false };
    const bbox = boundsFromActivities(included);
    if (!bbox) return { diagonalKm: 0, isDispersed: false };
    const km = distanceKm(bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng);
    return { diagonalKm: km, isDispersed: km > DISPERSED_THRESHOLD_KM };
  }, [included]);

  const handleCreateComposite = () => {
    if (included.length < 2) return;
    if (isDispersed) {
      setDispersionWarn(true);
      return;
    }
    onSelectMultiple(included);
  };

  const handleConfirmDispersedCompile = () => {
    setDispersionWarn(false);
    onSelectMultiple(included);
  };

  const handleDispersedPickRegion = (r: { label: string; lat: number; lng: number; count: number }) => {
    setFilterMode('region');
    setLocation('');
    setRegion({ centerLat: r.lat, centerLng: r.lng, radiusKm, label: r.label });
    setRegionQuery(r.label);
    setFiltersOpen(true);
    setDispersionWarn(false);
    setTimeout(() => filtersSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const handleOpenRegionFilter = () => {
    setFilterMode('region');
    setFiltersOpen(true);
    setDispersionWarn(false);
    setTimeout(() => filtersSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div ref={filtersSectionRef} className="p-4 border-b border-white/10 space-y-3">
        <input
          type="text"
          placeholder={isComposite ? 'Search runs to include…' : 'Search by name or location…'}
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

        {/* Distance band pills (single only) */}
        {!isComposite && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setDistanceBand(null)}
              className={`text-xs px-2.5 py-1.5 md:py-1 rounded-full border transition-colors ${
                distanceBand === null
                  ? 'border-white/40 bg-white/15 text-white'
                  : 'border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
              }`}
            >
              Any distance
            </button>
            {DISTANCE_BANDS.map((band) => (
              <button
                key={band.id}
                onClick={() => setDistanceBand((prev) => (prev === band.id ? null : band.id))}
                className={`text-xs px-2.5 py-1.5 md:py-1 rounded-full border transition-colors ${
                  distanceBand === band.id
                    ? 'border-white/40 bg-white/15 text-white'
                    : 'border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
                }`}
              >
                {band.label}
              </button>
            ))}
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
          {isComposite ? 'Place & date' : 'More filters'} {hasActiveFilters && <span className="text-white/60">(active)</span>}
        </button>

        {/* Collapsible filter section — always visible on desktop, toggle on mobile */}
        <div className={`space-y-3 ${filtersOpen ? 'block' : 'hidden'} md:block`}>
          {/* Location / Region — composite only (the spatial story is what a
              composite is about; a single run already has one place). */}
          {isComposite && (
            <>
              <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
                <button
                  onClick={() => { setFilterMode('region'); setLocation(''); }}
                  className={`flex-1 text-xs py-2 md:py-1.5 rounded-md transition-colors ${
                    filterMode === 'region' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  Place + radius
                </button>
                <button
                  onClick={() => { setFilterMode('location'); setRegion(null); }}
                  className={`flex-1 text-xs py-2 md:py-1.5 rounded-md transition-colors ${
                    filterMode === 'location' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  By named location
                </button>
              </div>

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

              {filterMode === 'region' && (
                <div className="space-y-2">
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

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Search a place…"
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
                      {geocoding ? '…' : 'Search'}
                    </button>
                  </div>

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
                      Including runs within {radiusKm}km of {region.label}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Date filters (both modes) */}
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

        {/* Composite action bar: the filtered set IS the composite. */}
        {isComposite ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">
                {included.length} run{included.length === 1 ? '' : 's'} in this composite
                {excludedIds.size > 0 && <span className="text-white/25"> · {excludedIds.size} excluded</span>}
              </span>
              {syncingMore && (
                <span className="flex items-center gap-1.5 text-xs text-white/40">
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border border-white/20 border-t-white/60" />
                  more loading…
                </span>
              )}
            </div>
            <button
              onClick={handleCreateComposite}
              disabled={included.length < 2}
              className="w-full text-sm px-3 py-2.5 rounded-lg bg-white text-black font-medium hover:bg-white/90 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {included.length < 2
                ? 'Pick a place or date with 2+ runs'
                : `Create composite of ${included.length} runs`}
            </button>
            <p className="text-xs text-white/25">
              Every run matching your filters is included. Tap a run below to leave it out.
            </p>
          </div>
        ) : (
          <div className="text-xs text-white/40">
            {filtered.length} run{filtered.length === 1 ? '' : 's'} with GPS tracks · tap one to make a poster
          </div>
        )}
      </div>

      {/* Activity list */}
      <div className="flex-1 overflow-y-auto">
        {/* Single mode: suggested hero runs */}
        {!isComposite && heroRuns.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <div className="text-xs uppercase tracking-wider text-white/30 mb-2">Suggested</div>
            <div className="grid grid-cols-2 gap-2">
              {heroRuns.map((activity) => (
                <button
                  key={activity.id}
                  onClick={() => onSelectSingle(activity)}
                  className="text-left p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 active:bg-white/15 transition-colors"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    {isRace(activity) && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#FC5200]/20 text-[#FC5200] font-medium">Race</span>
                    )}
                    <span className="text-sm font-medium text-white truncate">{formatDistance(activity.distance)}</span>
                  </div>
                  <div className="text-xs text-white/50 truncate">{activity.name}</div>
                  <div className="text-[11px] text-white/30 truncate">{formatDate(activity.date)} · {activity.location}</div>
                </button>
              ))}
            </div>
            <div className="text-xs uppercase tracking-wider text-white/30 mt-4 mb-1">All runs</div>
          </div>
        )}

        {(isComposite ? filtered : filtered.filter((a) => !heroIds.has(a.id))).map((activity) => {
          const isExcluded = isComposite && excludedIds.has(activity.id);
          return (
            <button
              key={activity.id}
              onClick={() => (isComposite ? toggleExclude(activity.id) : onSelectSingle(activity))}
              className={`w-full text-left px-4 py-4 md:py-3 border-b border-white/5 hover:bg-white/5 active:bg-white/10 transition-colors ${
                isExcluded ? 'opacity-40' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {isComposite && (
                    <div className={`w-6 h-6 md:w-4 md:h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                      !isExcluded ? 'bg-white border-white' : 'border-white/30'
                    }`}>
                      {!isExcluded && (
                        <svg className="w-4 h-4 md:w-3 md:h-3 text-black" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate flex items-center gap-1.5">
                      {!isComposite && isRace(activity) && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#FC5200]/20 text-[#FC5200] font-medium">Race</span>
                      )}
                      {activity.name}
                    </div>
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
          );
        })}

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

      <DispersedCompileModal
        open={dispersionWarn}
        runCount={included.length}
        diagonalKm={diagonalKm}
        regions={suggestedRegions}
        onClose={() => setDispersionWarn(false)}
        onPickRegion={handleDispersedPickRegion}
        onCompileAnyway={handleConfirmDispersedCompile}
        onOpenRegionFilter={handleOpenRegionFilter}
      />
    </div>
  );
}
