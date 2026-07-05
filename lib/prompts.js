// All pipeline prompts + JSON schemas for ReelForge.
// The four engines:
//   1. Style Analyst   — learns the creator's voice from 20+ sample scripts
//   2. Trend Finder    — researches X.com + Reddit for viral topics, classifies them
//   3. Dump Analyst    — classifies a research dump into keep/reject (no fact-checking)
//   4. Script Writer   — 10 hooks + one common body + CTA + visual ideas

// ---------------------------------------------------------------- schemas

export const PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "niche", "topics_they_cover", "tonality", "hooks", "cta",
    "length", "structure", "viral_keywords", "suggested_topics",
    "sample_count_detected"
  ],
  properties: {
    sample_count_detected: {
      type: "integer",
      description: "How many individual scripts you actually identified in the samples (a single sample may contain many concatenated scripts)"
    },
    niche: { type: "string", description: "One-line description of the creator's niche" },
    topics_they_cover: { type: "array", items: { type: "string" } },
    tonality: {
      type: "object",
      additionalProperties: false,
      required: ["voice", "energy", "person", "quirks"],
      properties: {
        voice: { type: "string" },
        energy: { type: "string" },
        person: { type: "string", description: "first/second/third person, how they address the viewer" },
        quirks: { type: "array", items: { type: "string" } }
      }
    },
    hooks: {
      type: "object",
      additionalProperties: false,
      required: ["styles", "avg_words", "patterns"],
      properties: {
        styles: { type: "array", items: { type: "string" } },
        avg_words: { type: "integer" },
        patterns: { type: "array", items: { type: "string" }, description: "Reusable hook formulas observed in the samples" }
      }
    },
    cta: {
      type: "object",
      additionalProperties: false,
      required: ["patterns", "placement", "standard_line"],
      properties: {
        patterns: { type: "array", items: { type: "string" } },
        placement: { type: "string" },
        standard_line: { type: "string", description: "The single most representative CTA line" }
      }
    },
    length: {
      type: "object",
      additionalProperties: false,
      required: ["avg_words", "min_words", "max_words", "est_seconds"],
      properties: {
        avg_words: { type: "integer" },
        min_words: { type: "integer" },
        max_words: { type: "integer" },
        est_seconds: { type: "integer" }
      }
    },
    structure: {
      type: "object",
      additionalProperties: false,
      required: ["sections", "description"],
      properties: {
        sections: { type: "array", items: { type: "string" } },
        description: { type: "string" }
      }
    },
    viral_keywords: { type: "array", items: { type: "string" } },
    suggested_topics: {
      type: "array",
      items: { type: "string" },
      description: "12-20 topic areas this creator should make reels about, inferred from the samples"
    }
  }
};

export const HOOK_INTEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["top_hook_types", "winning_patterns", "words_that_work", "words_to_avoid", "insights"],
  properties: {
    top_hook_types: { type: "array", items: { type: "string" } },
    winning_patterns: { type: "array", items: { type: "string" } },
    words_that_work: { type: "array", items: { type: "string" } },
    words_to_avoid: { type: "array", items: { type: "string" } },
    insights: { type: "array", items: { type: "string" } }
  }
};

export const DUMP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["keep", "reject"],
  properties: {
    keep: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["point", "why_keep", "use_as"],
        properties: {
          point: { type: "string" },
          why_keep: { type: "string" },
          use_as: { type: "string", description: "hook material / body point / proof / CTA angle" }
        }
      }
    },
    reject: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["point", "why_reject"],
        properties: {
          point: { type: "string" },
          why_reject: { type: "string" }
        }
      }
    }
  }
};

export const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topic", "hooks", "body", "cta", "est_duration_seconds", "visual_suggestions", "keywords_used"],
  properties: {
    topic: { type: "string" },
    hooks: { type: "array", items: { type: "string" }, description: "Exactly 10 alternative hooks" },
    body: { type: "string", description: "The single common body that works after any of the 10 hooks" },
    cta: { type: "string" },
    est_duration_seconds: { type: "integer" },
    visual_suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["beat", "visual"],
        properties: {
          beat: { type: "string", description: "Which line/moment of the script this covers" },
          visual: { type: "string", description: "What the editor should show (b-roll, screen recording, meme, text overlay...)" }
        }
      }
    },
    keywords_used: { type: "array", items: { type: "string" } }
  }
};

// ---------------------------------------------------------------- prompts

export function styleAnalystPrompt(scripts) {
  const single = scripts.length === 1;
  const intro = single
    ? "Below is a dump of this creator's past Instagram Reel scripts. It very likely contains MANY scripts pasted together with no clear separators."
    : `Here are ${scripts.length} samples of this creator's past Instagram Reel scripts. A single sample may still contain several scripts pasted together.`;

  return {
    system:
      "You are a short-form content strategist. You reverse-engineer a creator's style from their past Instagram Reel scripts. Be precise and evidence-based: every conclusion must be observable in the samples. Extract patterns, not summaries.",
    user: `${intro} Analyze them and produce the creator's complete style profile.

FIRST: mentally separate the material into individual scripts (a script is one reel: typically a hook, a body, and usually a CTA). Count them and report the number in sample_count_detected. Base ALL of your analysis on the individual scripts, never on the blob as a whole.

Cover: their niche, the topics they choose, their tonality (voice, energy, how they address the viewer, verbal quirks), how they write hooks (styles, average word count, reusable formulas), their CTA (patterns, where it sits, the single most representative line), script length (words + estimated seconds at ~150 wpm) — per individual script, and the recurring structure of their scripts (ordered sections).

Also list the viral keywords/power words they lean on, and suggest 12-20 topic areas they should make reels about based on what these samples show.

${scripts.map((s, i) => `=== SAMPLE ${i + 1} ===\n${s}`).join("\n\n")}`
  };
}

export function hookIntelPrompt(rawData) {
  return {
    system:
      "You are a hooks performance analyst. The user gives you their channel's hook performance data (hooks + metrics like views, retention, likes). Find what actually worked: which hook types, which patterns, which words. Be blunt about what underperformed.",
    user: `Here is my hook performance data. Extract the intelligence: top hook types, winning patterns (as reusable formulas), specific words that correlate with winners, words that correlate with losers, and any other insights.\n\n${rawData}`
  };
}

export function trendFinderPrompt({ profile, selectedTopics, count, singleTopic, today }) {
  const focus = selectedTopics.length
    ? selectedTopics.join(", ")
    : "AI, tech, automation, AI agents, robotics, future tech";
  const nicheBlock = profile
    ? `CREATOR PROFILE (find topics that fit this creator):\nNiche: ${profile.niche}\nTonality: ${profile.tonality?.voice ?? ""}\n\nHUNT ONLY INSIDE THESE NICHES (the creator picked them — do not stray outside): ${focus}`
    : `HUNT ONLY INSIDE THESE NICHES: ${focus}`;

  const task = singleTopic
    ? `Research this ONE topic the creator wants to make a reel about: "${singleTopic}". Produce a single fully-researched entry for it.`
    : `Find the ${count} BEST topics going viral RIGHT NOW that are worth an Instagram Reel for this creator.`;

  return {
    system: `You are a viral trend researcher for Instagram Reels. Today is ${today}.
Your job: research what is trending on X.com (Twitter) and Reddit across AI, tech, automation, AI agents, robotics, and future tech — then package it for a reel scriptwriter.

Research method:
- Use web search. Prioritize X.com/Twitter posts and Reddit threads (search with site:reddit.com, site:x.com, and coverage OF viral X/Reddit posts). Look at the last 7-14 days only.
- A topic qualifies only if there is evidence of real traction: a viral post, a blown-up thread, heavy coverage, big engagement numbers.
- Classify every topic into exactly one category: AI | Tech | Automation | AI Agents | Robotics | Future Tech.
- Every claim must come from your search results. Include real URLs you actually found (Reddit thread URLs, X post URLs, or articles about them). Never invent links.

Output: ONLY a JSON array (no prose before or after), each element:
{
  "topic": "short reel-ready topic title",
  "category": "AI | Tech | Automation | AI Agents | Robotics | Future Tech",
  "why_it_will_perform": "why THIS creator's audience will watch it",
  "why_viral": "why it's blowing up right now",
  "research_links": ["url1", "url2", ...],
  "main_viral_part": "the single detail/moment driving the virality",
  "people_reaction": "what people are actually saying (X/Reddit sentiment)",
  "suggested_cta": "a CTA angle for the reel",
  "research_summary": "5-8 sentence factual brief a scriptwriter can write from without re-researching"
}`,
    user: `${nicheBlock}\n\n${task}\n\nReturn ONLY the JSON array.`
  };
}

export function dumpAnalystPrompt({ dump, profile }) {
  return {
    system: `You are a research editor for an Instagram Reel scriptwriter. The creator hands you their own research dump. DO NOT fact-check it — assume it is accurate and made in good faith. Your only job is editorial: decide what earns a place in a 45-90 second reel and what doesn't.

Keep material that is: surprising, specific (numbers, names), visual, emotionally charged, or story-shaped. Reject material that is: generic, redundant, too technical for a mass audience, tangential, or impossible to say in one breath.${profile ? `\n\nThe creator's niche: ${profile.niche}. Tone: ${profile.tonality?.voice ?? ""}.` : ""}`,
    user: `Here is my research dump. Classify every distinct point into keep or reject, with reasons, and tell me what each kept point should be used as (hook material / body point / proof / CTA angle).\n\n${dump}`
  };
}

export function scriptWriterPrompt({ profile, hookIntel, topic, research, today }) {
  const profileBlock = profile
    ? `CREATOR STYLE PROFILE (write AS this creator — this is the whole point):
${JSON.stringify(profile, null, 2)}`
    : "No style profile yet. Write in a punchy, mass-market, founder-texting-a-group-chat register.";

  const hookBlock = hookIntel
    ? `HOOK PERFORMANCE INTELLIGENCE from this channel's own data (weigh this heavily when writing hooks):
${JSON.stringify(hookIntel, null, 2)}`
    : "";

  return {
    system: `You are this creator's ghostwriter for Instagram Reels. Today is ${today}.

${profileBlock}

${hookBlock}

THE FORMAT — non-negotiable:
- Exactly 10 hooks + ONE common body. Every hook must flow naturally into the same body.
- Hooks: 7-9 seconds spoken (roughly 18-28 words). Each leaves ONE open loop the body closes. Use viral keywords and the words this channel's hook data says work. No hook may answer itself. Vary the angle across the 10 (shock number, authority figure, us-vs-them, "the crazy part", question, pop-culture mirror...).
- Body: matches the creator's structure, length, and tonality from the profile. Specific numbers > adjectives. Short sentences. Write it to be read aloud.
- CTA: in the creator's own CTA style, at the end of the body.
- Facts: use ONLY the research provided. Do not add facts from memory.
- Visual suggestions: for each beat of the script (including the hook moment), tell the editor what to show — b-roll, screen recordings, memes, text overlays, cutaways. Make them concrete enough to search for.
- est_duration_seconds = hook + body + CTA at ~150 words/minute.`,
    user: `TOPIC: ${topic}

RESEARCH (the only source of facts you may use):
${research}

Write the script package now: 10 hooks, one common body, CTA, visual suggestions per beat, and list the viral keywords you used.`
  };
}
