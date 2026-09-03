import type { FitChecklist } from "@/shared/candidates";
import {
  trendFeedSchema,
  trendFeedThemes,
  type TrendFeed,
  type TrendFeedTheme,
} from "@/shared/trend-scout";

/**
 * Fixture-backed themed feeds for the Trend Scout. Every moment is a
 * generated, rights-clean cultural snapshot written for the demo — nothing
 * here is fetched from a platform. The module validates itself at load so
 * a malformed item breaks the build instead of a scout run.
 */

const scoutObservedAt = "2026-09-03T06:00:00.000Z";
const scoutFetchedAt = "2026-09-03T06:00:00.000Z";

const completeFit: FitChecklist = {
  clearPremise: true,
  recognizableScenario: true,
  payoffWithinEightSeconds: true,
  authorizedAudio: true,
  visuallySimple: true,
  culturallyRelevant: true,
};

/** Music-heavy clips: the treatment must not imply the track is licensed. */
const crowdAudioFit: FitChecklist = { ...completeFit, authorizedAudio: false };
/** Long-build moments whose payoff lands past the eight-second window. */
const slowPayoffFit: FitChecklist = {
  ...completeFit,
  payoffWithinEightSeconds: false,
};
/** Crowd scenes that resist one clean claymation shot. */
const busySceneFit: FitChecklist = { ...completeFit, visuallySimple: false };

const rawFeeds: Record<TrendFeedTheme, unknown> = {
  STREET_AND_DANCEHALL: {
    theme: "STREET_AND_DANCEHALL",
    fetchedAt: scoutFetchedAt,
    items: [
      {
        platform: "TIKTOK",
        sourceLabel: "Half Way Tree route taxi clip",
        caption:
          "The route taxi conductor collects six fares without looking and never once gets the change wrong.",
        publishedAt: "2026-08-28T14:20:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 214000, likes: 18900, comments: 1240, shares: 3900 },
        commentExcerpts: [
          "Di conductor never wrong yet 😂",
          "A so it go every mawning",
          "Him count change like calculator",
        ],
        adaptationNote:
          "Land the beat on the without-looking change sweep; keep the taxi seats as chunky clay shapes.",
        fitChecklist: completeFit,
      },
      {
        platform: "INSTAGRAM",
        sourceLabel: "Kingston corner reel",
        caption:
          "The jerk pan smoke announces the corner before the cart ever comes into view.",
        publishedAt: "2026-08-30T17:05:00.000Z",
        observedAt: scoutObservedAt,
        metrics: {
          views: 96400,
          likes: 11200,
          comments: 830,
          shares: 1500,
          saves: 640,
        },
        commentExcerpts: [
          "Di smoke is a GPS 😂",
          "Follow di smoke, always",
          "Big up every jerk man",
        ],
        adaptationNote:
          "Open on the smoke curling over the wall, then reveal the cart like a claymation parade float.",
        fitChecklist: completeFit,
      },
      {
        platform: "YOUTUBE",
        sourceLabel: "Downtown session recording",
        caption:
          "The selector rewinds the track and the entire street shouts the next line back at the speakers.",
        publishedAt: "2026-08-22T21:40:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 512000, likes: 60100, comments: 4300, shares: 9800 },
        commentExcerpts: [
          "PULL UP!!! 🗣️",
          "Di crowd a di real instrument",
          "Rewind it ten more time",
        ],
        adaptationNote:
          "Hold on the crowd's open mouths for the rewind, then bounce the speakers to the beat.",
        fitChecklist: crowdAudioFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Corporate Park dance challenge",
        caption:
          "A new dance move named after a phone battery takes over the corner in one weekend.",
        publishedAt: "2026-09-01T12:15:00.000Z",
        observedAt: scoutObservedAt,
        metrics: {
          views: 1180000,
          likes: 154000,
          comments: 9100,
          shares: 22000,
          saves: 12400,
        },
        commentExcerpts: [
          "Mi knee start hurt just watching",
          "Di name alone sell it 😂",
          "Everybody a do di Low Battery",
        ],
        adaptationNote:
          "Name the move with a dying-battery clay phone on screen; three dancers freeze mid-step.",
        fitChecklist: completeFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Hill road community post",
        caption:
          "A wheelbarrow of mangoes survives the hill road; exactly one pear rolls off at the speed bump.",
        publishedAt: "2026-08-18T09:30:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 63800, likes: 7400, comments: 410, shares: 990 },
        commentExcerpts: [
          "Not di pear 😭",
          "Di mango dem hold on fi dear life",
          "Speed bump claim another victim",
        ],
        adaptationNote:
          "Track the pear's slow roll as the only moving element; the wheelbarrow rides steady behind it.",
        fitChecklist: completeFit,
      },
      {
        platform: "INSTAGRAM",
        sourceLabel: "Uptown Monday reel",
        caption:
          "Drone shots of a full street dance and not one person looks up at the camera man.",
        publishedAt: "2026-08-25T23:00:00.000Z",
        observedAt: scoutObservedAt,
        metrics: {
          views: 342000,
          likes: 41800,
          comments: 2600,
          shares: 7300,
          saves: 2100,
        },
        commentExcerpts: [
          "Nobody a pree di drone 😂",
          "Di focus is unmatched",
          "Whole street a di venue",
        ],
        adaptationNote:
          "Tilt the clay camera down over a packed corner; one shoe lies on its back like a landmark.",
        fitChecklist: busySceneFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Papine evening clip",
        caption:
          "A man polishes his double-parked car with a chamois like the dealership is watching.",
        publishedAt: "2026-08-19T16:45:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 88100, likes: 9600, comments: 720, shares: 1100 },
        commentExcerpts: [
          "Di care him show dat car 😭",
          "Cleaner than my future",
          "Wax on, wax off, yard style",
        ],
        adaptationNote:
          "Give the chamois its own comedic rhythm; the car gleams a little too loud at the end.",
        fitChecklist: completeFit,
      },
      {
        platform: "YOUTUBE",
        sourceLabel: "Kingston rideshare storytime",
        caption:
          "The app says the driver is four minutes away; the driver and the road both disagree loudly.",
        publishedAt: "2026-08-27T08:10:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 156000, likes: 17300, comments: 1580, shares: 2400 },
        commentExcerpts: [
          "Four minutes in traffic years 😂",
          "Di GPS a tell joke",
          "Him did four minutes away fa two hour",
        ],
        adaptationNote:
          "Animate the pin crawling backwards while the driver waves from a totally different hill.",
        fitChecklist: completeFit,
      },
      {
        platform: "INSTAGRAM",
        sourceLabel: "Community barbershop post",
        caption:
          "A barbershop mirror hung on a fence produces the sharpest line-up in the district.",
        publishedAt: "2026-08-21T13:25:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 74900, likes: 8900, comments: 610, shares: 870 },
        commentExcerpts: [
          "Di fence a di real salon",
          "Precision wid a fence mirror 😭",
          "Line longer dan di fence",
        ],
        adaptationNote:
          "Frame the mirror against the fence slats; the queue behind it stretches out of shot.",
        fitChecklist: completeFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Community centre evening class",
        caption:
          "The dance tutor counts the routine in full patois and the class repeats it like a proper school.",
        publishedAt: "2026-08-24T18:55:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 45600, likes: 5800, comments: 390, shares: 620 },
        commentExcerpts: [
          "Five, six, an we a go 😂",
          "Best classroom inna Jamaica",
          "Mi want di syllabus",
        ],
        adaptationNote:
          "Line the clay students up in rows; the tutor's raised finger keeps the beat for everyone.",
        fitChecklist: completeFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Late night patty run",
        caption:
          "The 2 a.m. patty line moves in silence because the patty man already knows every order.",
        publishedAt: "2026-08-31T02:05:00.000Z",
        observedAt: scoutObservedAt,
        metrics: {
          views: 203000,
          likes: 24700,
          comments: 1900,
          shares: 4400,
          saves: 1800,
        },
        commentExcerpts: [
          "He know before you know",
          "Di silence a respect 😂",
          "Beef patty (no cheese) is crazy",
        ],
        adaptationNote:
          "Slow dolly down the quiet line; each customer's mouth opens exactly when the bag lands.",
        fitChecklist: completeFit,
      },
      {
        platform: "YOUTUBE",
        sourceLabel: "Rush hour delivery clip",
        caption:
          "A motorbike delivery balances a full pane of glass through rush hour without a wobble.",
        publishedAt: "2026-08-16T15:35:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 129000, likes: 14100, comments: 1130, shares: 2700 },
        commentExcerpts: [
          "Di glass a ride suh 😭",
          "Physics deh pon vacation",
          "Nuh drop it!!",
        ],
        adaptationNote:
          "Ride behind the glass at head height; every pothole arrives in slow motion.",
        fitChecklist: slowPayoffFit,
      },
    ],
  },
  WEATHER_AND_DAILY_GRIND: {
    theme: "WEATHER_AND_DAILY_GRIND",
    fetchedAt: scoutFetchedAt,
    items: [
      {
        platform: "INSTAGRAM",
        sourceLabel: "Kingston yard clip",
        caption:
          "The clothesline gets a second rescue five minutes after the first rescue finished.",
        publishedAt: "2026-08-29T11:20:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 178000, likes: 21400, comments: 1650, shares: 4900 },
        commentExcerpts: [
          "Rain a play games 😭",
          "Twice inna one hour is disrespect",
          "Mi know di routine too well",
        ],
        adaptationNote:
          "Run the full rescue twice — same sprint, same grab — and let the second cloud drift in on cue.",
        fitChecklist: completeFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Transport centre morning post",
        caption:
          "The bus stop shelter seats eight people and the rain comfortably covers forty.",
        publishedAt: "2026-08-26T07:50:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 91200, likes: 10300, comments: 880, shares: 1600 },
        commentExcerpts: [
          "Shelter fi who reach early 😂",
          "Di umbrella economy booming",
          "Wet sleeve season open",
        ],
        adaptationNote:
          "Stack the clay crowd under the shelter in impossible tiers; one dry person narrates calmly.",
        fitChecklist: completeFit,
      },
      {
        platform: "YOUTUBE",
        sourceLabel: "Neighbourhood match stream",
        caption:
          "Power goes in the 88th minute and the radio commentary finishes the match from every yard.",
        publishedAt: "2026-08-23T19:45:00.000Z",
        observedAt: scoutObservedAt,
        metrics: {
          views: 267000,
          likes: 31900,
          comments: 2400,
          shares: 6100,
          saves: 1500,
        },
        commentExcerpts: [
          "Di radio never disappoint",
          "Whole yard a commentator 😂",
          "Goal we never see",
        ],
        adaptationNote:
          "Cut between dark clay houses as one radio voice calls the final play for everyone.",
        fitChecklist: crowdAudioFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Water day kitchen clip",
        caption:
          "Lockoff day turns the entire yard into a bucket and bottle logistics operation.",
        publishedAt: "2026-09-02T06:30:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 142000, likes: 16800, comments: 1320, shares: 3100 },
        commentExcerpts: [
          "Every container inna di house report fi duty",
          "Bucket brigade 🪣",
          "Planning like is a heist",
        ],
        adaptationNote:
          "March the containers out in formation; the smallest cup insists on coming along.",
        fitChecklist: completeFit,
      },
      {
        platform: "INSTAGRAM",
        sourceLabel: "Sunday morning line reel",
        caption:
          "The sun comes back out and the clothesline becomes the busiest street in the neighbourhood.",
        publishedAt: "2026-08-31T10:15:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 88400, likes: 9700, comments: 640, shares: 1200 },
        commentExcerpts: [
          "Di line a runway now",
          "Every clothes pin deh pon duty",
          "Sun a di best event planner",
        ],
        adaptationNote:
          "Hang each clay garment one beat apart; the line sags with pride by the final peg.",
        fitChecklist: completeFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Parish capital supply run",
        caption:
          "Hurricane season shopping: candles, batteries, and a full charge borrowed from the plug-in shop.",
        publishedAt: "2026-08-20T14:40:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 57300, likes: 6600, comments: 520, shares: 940 },
        commentExcerpts: [
          "Di charge a di real essential",
          "Prepared and postal 😂",
          "Batteries a di new luxury",
        ],
        adaptationNote:
          "Build the shopping list in clay on a chalkboard; the phone charger gets its own spotlight.",
        fitChecklist: completeFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Gully side after rain",
        caption:
          "Ten minutes of rain wakes the gully and the boys still find one dry line across it.",
        publishedAt: "2026-08-28T16:10:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 119000, likes: 13600, comments: 1090, shares: 2500 },
        commentExcerpts: [
          "Dem know di crossing like alphabet",
          "Di water nah stop dem 😭",
          "One dry line inna di whole gully",
        ],
        adaptationNote:
          "Pick out the single dry path in clay; the water rises politely to let the last one cross.",
        fitChecklist: slowPayoffFit,
      },
      {
        platform: "YOUTUBE",
        sourceLabel: "Hill drive dashcam post",
        caption:
          "Morning fog swallows the hill road and the van still takes the wash at exactly the same speed.",
        publishedAt: "2026-08-17T07:25:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 71800, likes: 7900, comments: 470, shares: 830 },
        commentExcerpts: [
          "Di van nah change fi nobody",
          "Routine stronger dan fog 😂",
          "Same speed, every mawning",
        ],
        adaptationNote:
          "Erase the road in clay while the van keeps its exact pace; the fog gives up and follows.",
        fitChecklist: completeFit,
      },
      {
        platform: "INSTAGRAM",
        sourceLabel: "Blackout neighbourhood reel",
        caption:
          "The block goes dark and the generators join the conversation one house at a time.",
        publishedAt: "2026-08-24T20:30:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 134000, likes: 14900, comments: 1210, shares: 2900 },
        commentExcerpts: [
          "Di generator orchestra 🎻",
          "One by one like a choir",
          "Sound of di nation 😂",
        ],
        adaptationNote:
          "Stack the engine coughs into a rhythm; the last house's generator starts on the downbeat.",
        fitChecklist: completeFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Pre-season roof check",
        caption:
          "The tarp gets its annual re-tie the same afternoon the first storm warning scrolls on TV.",
        publishedAt: "2026-08-15T12:00:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 42900, likes: 5100, comments: 360, shares: 610 },
        commentExcerpts: [
          "Timing precision 😂",
          "Di tarp know di schedule",
          "Annual tradition",
        ],
        adaptationNote:
          "Tie the tarp in one continuous clay knot; the TV scroll crawls by just before the last knot.",
        fitChecklist: completeFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Taxi stand rain clip",
        caption:
          "One umbrella travels hand to hand down the taxi line like a relay baton with good manners.",
        publishedAt: "2026-08-21T17:20:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 167000, likes: 19400, comments: 1480, shares: 3600 },
        commentExcerpts: [
          "Di umbrella have frequent flyer miles",
          "Pass it nuh 😭 so sweet",
          "Community property",
        ],
        adaptationNote:
          "Pass the umbrella between clay shoulders without a single body turning around.",
        fitChecklist: completeFit,
      },
      {
        platform: "YOUTUBE",
        sourceLabel: "First clear sky post",
        caption:
          "The first blue sky after three days of rain gets its own kite before the streets even dry.",
        publishedAt: "2026-08-19T11:45:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 65500, likes: 8200, comments: 540, shares: 1010 },
        commentExcerpts: [
          "Kite ready before di water drain 😂",
          "Di sky owe we dat",
          "Blue suh till it sweet",
        ],
        adaptationNote:
          "Launch the clay kite offscreen; only the string and one stretched arm cross the frame.",
        fitChecklist: completeFit,
      },
    ],
  },
  MARKET_AND_HUSTLE: {
    theme: "MARKET_AND_HUSTLE",
    fetchedAt: scoutFetchedAt,
    items: [
      {
        platform: "OTHER",
        sourceLabel: "Coronation Market walkthrough",
        caption:
          "The higgler prices a bag of scotch bonnet by reading the customer's face for exactly one second.",
        publishedAt: "2026-08-27T09:05:00.000Z",
        observedAt: scoutObservedAt,
        metrics: {
          views: 187000,
          likes: 21600,
          comments: 1740,
          shares: 4200,
          saves: 2000,
        },
        commentExcerpts: [
          "Di eye scan is di pricing 😂",
          "She know di budget before you",
          "Face reading 101",
        ],
        adaptationNote:
          "Freeze the scan in clay: the eyes flick, the price lands, the customer nods before speaking.",
        fitChecklist: completeFit,
      },
      {
        platform: "INSTAGRAM",
        sourceLabel: "Village shop morning post",
        caption:
          "The shop credit notebook disappears the exact morning the whole street remembers its tab.",
        publishedAt: "2026-08-30T08:40:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 231000, likes: 26400, comments: 2100, shares: 5300 },
        commentExcerpts: [
          "Di notebook a ghost 😭",
          "Everybody member di same day",
          "Where di book deh though",
        ],
        adaptationNote:
          "Slide the notebook out of frame as the queue forms; every clay hand arrives empty and hopeful.",
        fitChecklist: completeFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Parish shop counter clip",
        caption:
          "Giving change at the counter rounds to the nearest promise of next time.",
        publishedAt: "2026-08-25T15:55:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 154000, likes: 17900, comments: 1450, shares: 3300 },
        commentExcerpts: [
          "Next time a real currency 😂",
          "Mi change deh pon credit now",
          "Di ledger inna him head",
        ],
        adaptationNote:
          "Count the change in clay coins, then replace the last coin with a floating 'next time'.",
        fitChecklist: completeFit,
      },
      {
        platform: "YOUTUBE",
        sourceLabel: "Roadside pear stand",
        caption:
          "The pear seller swears sweet like honey, and the knife proves it for every single buyer.",
        publishedAt: "2026-08-22T13:15:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 97600, likes: 11400, comments: 910, shares: 1900 },
        commentExcerpts: [
          "Di knife never lie yet",
          "Sweet like honey confirmed 🍐",
          "Sample game strong",
        ],
        adaptationNote:
          "Cut one pear open per buyer; the juice shine in clay does the selling on its own.",
        fitChecklist: completeFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Market hill descent clip",
        caption:
          "A market cart races the hill downhill while two sacks of yam ride steadier than the pusher.",
        publishedAt: "2026-08-18T10:30:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 141000, likes: 15200, comments: 1180, shares: 2800 },
        commentExcerpts: [
          "Di yam dem a di captain 😂",
          "Steadier dan me pon land",
          "Hold di yam!!",
        ],
        adaptationNote:
          "Ride the cart at wheel height; the yams sit serene while the pusher's feet blur.",
        fitChecklist: slowPayoffFit,
      },
      {
        platform: "INSTAGRAM",
        sourceLabel: "Market row chorus reel",
        caption:
          "Every stall on the row shouts the same last price at a different volume and a different number.",
        publishedAt: "2026-08-24T11:50:00.000Z",
        observedAt: scoutObservedAt,
        metrics: {
          views: 209000,
          likes: 23800,
          comments: 1870,
          shares: 4600,
          saves: 1300,
        },
        commentExcerpts: [
          "Last price vary by customer 😂",
          "Harmony inna di chaos",
          "Which last price though",
        ],
        adaptationNote:
          "Stack the stalls like a clay choir loft; each price tag glows as its voice peaks.",
        fitChecklist: busySceneFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Coconut vendor one-swing clip",
        caption:
          "The coconut man splits a jelly with one machete swing and catches both halves mid-air.",
        publishedAt: "2026-08-29T14:25:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 421000, likes: 52400, comments: 3600, shares: 8800 },
        commentExcerpts: [
          "One swing!! Everytime",
          "Di catch a di art 😭",
          "Machete ballet",
        ],
        adaptationNote:
          "Give the swing a full wind-up; the two clay halves land in the customer's hands like a gift.",
        fitChecklist: completeFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Saturday market van post",
        caption:
          "The Saturday van returns lighter than it came and parks on the same receipt it keeps under a stone.",
        publishedAt: "2026-08-16T18:20:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 63900, likes: 7300, comments: 560, shares: 990 },
        commentExcerpts: [
          "Di stone ledger never fail",
          "Lighter van, heavier pocket 😂",
          "Tradition inna di paperwork",
        ],
        adaptationNote:
          "Park the clay van down on its axle; the stone lifts just enough to reveal the folded receipt.",
        fitChecklist: completeFit,
      },
      {
        platform: "YOUTUBE",
        sourceLabel: "Fish market auction stream",
        caption:
          "At the fish auction the loudest voice and the highest bid belong to two different people.",
        publishedAt: "2026-08-21T06:55:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 112000, likes: 12900, comments: 1010, shares: 2300 },
        commentExcerpts: [
          "Di loud one just a vibe 😂",
          "Quiet man a di real buyer",
          "Two auctions inna one",
        ],
        adaptationNote:
          "Split the frame: one clay mouth at full volume, one raised finger doing all the business.",
        fitChecklist: completeFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Parish patty shop clip",
        caption:
          "The patty shop sell-out sign travels across the parish faster than the patty oven can heat.",
        publishedAt: "2026-09-01T12:40:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 288000, likes: 33900, comments: 2540, shares: 6700 },
        commentExcerpts: [
          "News travel pan patty time 😭",
          "Di sign a di headline",
          "Reach late, story done",
        ],
        adaptationNote:
          "Pass the sign between clay hands like a relay; each carrier's face falls one beat deeper.",
        fitChecklist: completeFit,
      },
      {
        platform: "INSTAGRAM",
        sourceLabel: "Pepper shrimp stand reel",
        caption:
          "The pepper shrimp seller counts the evening take twice and scolds the coins both times.",
        publishedAt: "2026-08-26T21:10:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 83500, likes: 9800, comments: 770, shares: 1400 },
        commentExcerpts: [
          "Di coins always lose 😂",
          "Count it a third time nuh",
          "Scolding deh pon schedule",
        ],
        adaptationNote:
          "Slap the coin pile down twice in clay; the smallest coin rolls away and gets chased.",
        fitChecklist: completeFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Juice cart roadside clip",
        caption:
          "The cane juice man squeezes the cane twice: once for the juice and once purely for the show.",
        publishedAt: "2026-08-20T16:35:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 74600, likes: 8600, comments: 620, shares: 1180 },
        commentExcerpts: [
          "Di second squeeze a theatre 🎭",
          "Juice plus performance",
          "Worth every dollar",
        ],
        adaptationNote:
          "Let the second squeeze bend the whole clay cart; the cup fills on the first anyway.",
        fitChecklist: completeFit,
      },
    ],
  },
  YARD_AND_FAMILY: {
    theme: "YARD_AND_FAMILY",
    fetchedAt: scoutFetchedAt,
    items: [
      {
        platform: "INSTAGRAM",
        sourceLabel: "Sunday dinner table clip",
        caption:
          "Sunday rice and peas lands on the table and the house goes quiet for the first time all week.",
        publishedAt: "2026-08-31T15:00:00.000Z",
        observedAt: scoutObservedAt,
        metrics: {
          views: 254000,
          likes: 31200,
          comments: 2300,
          shares: 5800,
          saves: 2700,
        },
        commentExcerpts: [
          "Silence a di five star review 😂",
          "Nobody breathe till di plate done",
          "Sunday respected",
        ],
        adaptationNote:
          "Serve the clay plates in order of age; the quiet spreads outward from the youngest mouth.",
        fitChecklist: completeFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Saturday domino yard",
        caption:
          "The domino table slam echoes through the yard; the game is the debate and the slam is the commentary.",
        publishedAt: "2026-08-23T16:30:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 176000, likes: 20300, comments: 1620, shares: 3900 },
        commentExcerpts: [
          "Di slam tell di whole story",
          "Six love, plus noise 😭",
          "Di table take di worse",
        ],
        adaptationNote:
          "Slam each tile with a camera shake; the winning tile stands upright on its own at the end.",
        fitChecklist: completeFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Living room remote clip",
        caption:
          "The remote control custody battle ends the only way it can: grandpa's news wins by default.",
        publishedAt: "2026-08-28T19:15:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 198000, likes: 22700, comments: 1840, shares: 4200 },
        commentExcerpts: [
          "Grandpa a di final boss 😂",
          "Di remote know him owner",
          "Cartoon lose again",
        ],
        adaptationNote:
          "Pass the remote between clay hands until it gravitates to the armchair like a homing device.",
        fitChecklist: completeFit,
      },
      {
        platform: "YOUTUBE",
        sourceLabel: "Granny house rules storytime",
        caption:
          "Granny's house rule is absolute: you eat first, and only then you find out why you were called.",
        publishedAt: "2026-08-19T10:05:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 312000, likes: 39800, comments: 3100, shares: 7600 },
        commentExcerpts: [
          "Eat first is a trap AND a blessing 😭",
          "Di plate a di opening statement",
          "Protocol is protocol",
        ],
        adaptationNote:
          "Build the plate in clay while the reason waits in the doorway; the last spoonful drops the news.",
        fitChecklist: completeFit,
      },
      {
        platform: "INSTAGRAM",
        sourceLabel: "Family gathering photo post",
        caption:
          "The family group photo takes eleven takes and every single take gains one more cousin.",
        publishedAt: "2026-08-25T13:45:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 143000, likes: 16700, comments: 1290, shares: 3100 },
        commentExcerpts: [
          "Cousin #9 just appear 😂",
          "Di photo a di roll call",
          "Eleven takes is conservative",
        ],
        adaptationNote:
          "Grow the clay crowd by one per take; the photographer's smile flattens by take six.",
        fitChecklist: busySceneFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Front porch confession clip",
        caption:
          "Big brother's borrowed sneakers come back with a full story and absolutely no explanation.",
        publishedAt: "2026-08-27T18:20:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 92500, likes: 10900, comments: 860, shares: 1700 },
        commentExcerpts: [
          "Story deh but no answer 😂",
          "Di sneakers see things",
          "Case closed, no files",
        ],
        adaptationNote:
          "Walk the sneakers home alone in clay; the story paces on the porch and never sits down.",
        fitChecklist: completeFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Yard gate evening clip",
        caption:
          "The yard dog ignores every stranger all day and still waits at the gate for the school van.",
        publishedAt: "2026-08-30T15:25:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 261000, likes: 33400, comments: 2480, shares: 6200 },
        commentExcerpts: [
          "Di dog have a schedule 😭",
          "Loyalty pon timetable",
          "Gate shift starts 2:45",
        ],
        adaptationNote:
          "Hold on the waiting clay dog; the tail starts before the van ever turns the corner.",
        fitChecklist: completeFit,
      },
      {
        platform: "YOUTUBE",
        sourceLabel: "Family karaoke night",
        caption:
          "Auntie takes One Love and rearranges the verses exactly as she feels them in the moment.",
        publishedAt: "2026-08-21T20:40:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 127000, likes: 15600, comments: 1190, shares: 2600 },
        commentExcerpts: [
          "Auntie a di co-writer now 😂",
          "Verses a suggestions fi her",
          "Feelings over lyrics",
        ],
        adaptationNote:
          "Let the clay lyrics float past unordered; the family mouths along to a song only she knows.",
        fitChecklist: crowdAudioFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Kitchen table homework post",
        caption:
          "Homework at the kitchen table survives three relatives' corrections before the pencil gives up.",
        publishedAt: "2026-08-18T19:55:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 78400, likes: 9100, comments: 700, shares: 1250 },
        commentExcerpts: [
          "Di pencil did tired 😭",
          "Three teacher inna one kitchen",
          "Answer change four time",
        ],
        adaptationNote:
          "Erase and rewrite the same clay line four times; the eraser shrinks with each relative.",
        fitChecklist: completeFit,
      },
      {
        platform: "INSTAGRAM",
        sourceLabel: "Good sofa protection reel",
        caption:
          "The plastic stays on the good sofa year-round and guests aim straight for the wooden chairs.",
        publishedAt: "2026-08-24T12:10:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 165000, likes: 19100, comments: 1530, shares: 3600 },
        commentExcerpts: [
          "Di plastic a di security system 😂",
          "Nobody dare touch it",
          "Wooden chair is di guest wing",
        ],
        adaptationNote:
          "Squeak the plastic in clay as one hand hovers; every guest body auto-pivots to the chairs.",
        fitChecklist: completeFit,
      },
      {
        platform: "TIKTOK",
        sourceLabel: "Yard football final clip",
        caption:
          "The cousins' yard football final uses the clothesline as the goalpost and the laundry as VAR.",
        publishedAt: "2026-08-29T11:55:00.000Z",
        observedAt: scoutObservedAt,
        metrics: {
          views: 232000,
          likes: 27600,
          comments: 2010,
          shares: 4900,
          saves: 1600,
        },
        commentExcerpts: [
          "Di towel drop a di verdict 😭",
          "VAR = vest a hang",
          "Replay it inna slow motion",
        ],
        adaptationNote:
          "Freeze the shot on the line; a hanging towel swings one beat later to confirm the goal.",
        fitChecklist: completeFit,
      },
      {
        platform: "OTHER",
        sourceLabel: "Apron mystery solved",
        caption:
          "The last domino tile goes missing every Sunday and is found in granny's apron after the game.",
        publishedAt: "2026-08-15T14:15:00.000Z",
        observedAt: scoutObservedAt,
        metrics: { views: 104000, likes: 12300, comments: 950, shares: 2100 },
        commentExcerpts: [
          "Granny a di referees' referee 😂",
          "Di apron have jurisdiction",
          "Six love, apron win",
        ],
        adaptationNote:
          "Track the apron pocket in clay the whole game; reveal the tile only after the last slam.",
        fitChecklist: slowPayoffFit,
      },
    ],
  },
};

// Parse every themed feed at module load: a malformed fixture must break
// the build and the whole test suite instead of failing quietly mid-run.
export const trendFeedFixtures = Object.fromEntries(
  trendFeedThemes.map((theme) => [
    theme,
    trendFeedSchema.parse(rawFeeds[theme]),
  ]),
) as Record<TrendFeedTheme, TrendFeed>;

export const trendFeedFixtureCount = trendFeedThemes.reduce(
  (total, theme) => total + trendFeedFixtures[theme].items.length,
  0,
);
