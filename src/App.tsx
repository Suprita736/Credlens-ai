import { useState, useEffect } from 'react';
import { Shield, Key, Check, AlertCircle } from 'lucide-react';

const App = () => {
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    chrome.storage.local.get(['geminiApiKey'], (result: { [key: string]: any }) => {
      if (result.geminiApiKey) {
        setApiKey(result.geminiApiKey);
      }
    });
  }, []);

  const saveApiKey = () => {
    if (!apiKey.startsWith('AIza')) {
      setError('Invalid API Key format');
      return;
    }

    chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 3000);
    });
  };

  return (
    <div className="w-80 p-6 bg-slate-900 text-white min-h-[300px] flex flex-col">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-blue-600 rounded-lg">
          <Shield size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">CredLens AI</h1>
          <p className="text-xs text-slate-400">Short-Form Content Verifier</p>
        </div>
      </div>

      <div className="flex-grow space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Gemini API Key
          </label>
          <div className="relative">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API Key"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            <Key className="absolute left-3 top-2.5 text-slate-500" size={16} />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs animate-in fade-in slide-in-from-top-2">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={saveApiKey}
          className={`
            w-full py-2 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2
            ${saved ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-500'}
          `}
        >
          {saved ? (
            <>
              <Check size={16} />
              Saved
            </>
          ) : (
            'Save API Key'
          )}
        </button>
      </div>

      <div className="mt-8 pt-6 border-t border-slate-800">
        <p className="text-[10px] text-slate-500 text-center">
          CredLens AI uses Gemini 1.5 Flash to analyze factual claims in real-time.
          Phase 1: YouTube Shorts Support.
        </p>
      </div>
    </div>
  );
};

export default App;
