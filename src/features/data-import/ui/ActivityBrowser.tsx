import { useState, useMemo } from 'react';
import type { ActivitySummary } from '@/types/activity';
import { filterActivities, getUniqueLocations } from '../services/garminLoader';
import { formatDistance, formatPace, formatDate } from '@/shared/utils/format';

interface ActivityBrowserProps {
  activities: ActivitySummary[];
  onSelectSingle: (activity: ActivitySummary) => void;
  onSelectMultiple: (activities: ActivitySummary[]) => void;
}

export function ActivityBrowser({ activities, onSelectSingle, onSelectMultiple }: ActivityBrowserProps) {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  const locations = useMemo(() => getUniqueLocations(activities), [activities]);

  const filtered = useMemo(
    () =>
      filterActivities(activities, { search, location: location || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined })
        .filter((a) => a.hasTrack)
        .sort((a, b) => b.timestamp - a.timestamp),
    [activities, search, location, dateFrom, dateTo]
  );

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

        <div className="flex gap-2">
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
          >
            <option value="">All locations</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-white/30"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-white/30"
          />
        </div>

        {/* Mode toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">
            {filtered.length} runs with GPS tracks
          </span>
          <div className="flex gap-2">
            {selectionMode && (
              <>
                <button
                  onClick={selectAllFiltered}
                  className="text-xs px-2 py-1 rounded bg-white/10 text-white/60 hover:text-white"
                >
                  Select all ({filtered.length})
                </button>
                <button
                  onClick={handleCreateCompilation}
                  disabled={selectedIds.size < 2}
                  className="text-xs px-3 py-1 rounded bg-white text-black font-medium disabled:opacity-30"
                >
                  Create compilation ({selectedIds.size})
                </button>
              </>
            )}
            <button
              onClick={() => { setSelectionMode(!selectionMode); setSelectedIds(new Set()); }}
              className={`text-xs px-2 py-1 rounded ${
                selectionMode ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:text-white'
              }`}
            >
              {selectionMode ? 'Cancel' : 'Multi-select'}
            </button>
          </div>
        </div>
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
            className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${
              selectedIds.has(activity.id) ? 'bg-white/10' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {selectionMode && (
                  <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                    selectedIds.has(activity.id) ? 'bg-white border-white' : 'border-white/30'
                  }`}>
                    {selectedIds.has(activity.id) && (
                      <svg className="w-3 h-3 text-black" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">{activity.name}</div>
                  <div className="text-xs text-white/40">
                    {formatDate(activity.date)} &middot; {activity.location}
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
      </div>
    </div>
  );
}
