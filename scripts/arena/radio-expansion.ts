/** An original Dutch section sent to Eleven Music's structured composition endpoint. */
export type RadioChunk = {
  text: string;
  duration_ms: number;
  positive_styles: string[];
  negative_styles: string[];
};
/** New licensed radio production, kept separate from the existing six recordings. */
export type RadioProduction = {
  station: string;
  stationName: string;
  title: string;
  seconds: number;
  prompt: string;
  chunks: RadioChunk[];
  content: "song" | "talk";
  transcript: string;
};

function piece(
  station: string,
  stationName: string,
  title: string,
  styles: string[],
  sections: [number, string, string[]?][],
  content: "song" | "talk" = "song",
): RadioProduction {
  return {
    station,
    stationName,
    title,
    seconds: sections.reduce((sum, [seconds]) => sum + seconds, 0),
    prompt: styles.join(", "),
    content,
    transcript: sections.map(([, text]) => text).join("\n\n"),
    chunks: sections.map(([seconds, text, local = []]) => ({
      text: text
        .split("\n")
        .flatMap((line) => {
          const lines = [""];
          for (const word of line.split(" ")) {
            if (lines[lines.length - 1].length + word.length + 1 > 190)
              lines.push(word);
            else
              lines[lines.length - 1] +=
                `${lines[lines.length - 1] ? " " : ""}${word}`;
          }
          return lines;
        })
        .join("\n"),
      duration_ms: seconds * 1000,
      positive_styles: [
        ...styles,
        "Dutch language only",
        "clear intelligible Dutch diction",
        "professional balanced radio mix",
        ...local,
      ],
      negative_styles: [
        "English lyrics",
        "clipping",
        "harsh sibilance",
        "muddy bass",
      ],
    })),
  };
}

/** Twelve original vocal tracks and fictional radio sketches; no existing song lyrics. */
export const RADIO_EXPANSION: RadioProduction[] = [
  piece(
    "ramen",
    "Radio Ramen",
    "De heilige bas",
    [
      "145 BPM acid rave",
      "ecstatic theatrical male preacher",
      "deep sub bass",
      "choir responses",
      "909 drums",
      "organ stabs",
    ],
    [
      [
        25,
        "[Spoken sermon]\nBroeders en zusters, hef uw vergiet! Het Vliegende Spaghettimonster heeft ons aangeraakt met zijn noedelige aanhangsel! Niet met een betaalverzoek, maar met de bas! Wie zonder saus is, werpe de eerste gehaktbal!",
      ],
      [
        25,
        "[Call and response]\nGeloof in de sliert!\nHef uw vergiet!\nWie stil blijft staan\nhoort de bas nog niet!\nRamen! Ramen!\nWij koken samen!",
      ],
      [
        55,
        "[Instrumental rave drop] {rolling acid bass, huge kick, choral stabs, euphoric synth hook, no words}",
        ["instrumental dance section"],
      ],
      [
        30,
        "[Final sermon and chorus]\nDe ketel bruist, de vloer beweegt\ngeen ziel die hier zijn bordje leegt\nGeloof in de sliert, hef uw vergiet\nwie stil blijft staan, hoort de bas nog niet!\nRamen! Ramen! Wij koken samen!",
      ],
      [
        15,
        "[Outro] {acid riff resolves, choir sings Ramen, clean musical ending}",
      ],
    ],
  ),
  piece(
    "ramen",
    "Radio Ramen",
    "Gekookt in het licht",
    [
      "140 BPM euphoric devotional trance parody",
      "operatic female response",
      "baritone preacher",
      "pipe organ chords",
      "warm deep bass",
      "wide supersaw lead",
    ],
    [
      [
        30,
        "[Verse]\nToen de avond viel op mijn vergiet\nzei een stem: vergeet de saus toch niet\nmet mijn handen naar de hemel toe\nwerd zelfs koude pasta minder moe",
      ],
      [
        25,
        "[Chorus]\nWij zijn gaar, maar niet verloren\nlaat de ketel ons bekoren\nin het licht van deze nacht\nheeft de bas ons thuisgebracht",
      ],
      [
        60,
        "[Instrumental communion] {organ melody into euphoric trance drop, wordless choir, deep rolling bass}",
        ["extended instrumental"],
      ],
      [
        35,
        "[Final chorus]\nWij zijn gaar, maar niet verloren\nlaat de ketel ons bekoren\nalle slierten hand in hand\ndansen door het pastaland\nWij zijn gaar, maar niet verloren\nlaat de ketel ons bekoren",
      ],
      [15, "[Outro] {organ cadence, shimmering pads, clean ending}"],
    ],
  ),
  piece(
    "vrij",
    "Vrije Frequentie",
    "Alles hangt samen",
    [
      "fictional satirical Dutch talk radio",
      "frantic male influencer monologue",
      "spoken not sung",
      "nervous electronic underscore",
      "short comic jingles",
      "clear foreground speech",
    ],
    [
      [
        25,
        "[Spoken]\nHier Bas Bewijs. Kijk, een duif is gewoon een router met veren. Waarom zit hij altijd op een antenne? Precies! En waarom is mijn wachtwoord geheim, maar weet mijn telefoon dat het fout is? Word wakker! Abonneer je, want mijn bereik wordt onderdrukt. Behalve bij de gesponsorde berichten. Daar werkt het opeens uitstekend.",
      ],
      [
        25,
        "[Spoken]\nRotondes zijn rond zodat je nooit bij de waarheid aankomt! Supermarktbonnetjes zijn codetaal. Er staat totaal op, maar nooit waarvan. Van mijn boodschappen? Dat willen ze je laten denken. Mijn buurman zei: Bas, ga slapen. Slapen! Acht uur lang je ogen dicht. Handig voor de mensen die alles regelen, toch?",
      ],
      [
        25,
        "[Spoken]\nZelfs mijn ringlamp zit erin. Een cirkel van licht, exact als een rotonde. Toeval bestaat niet, behalve toen ik mijn onderzoek kwijt was. De koelkast heeft een lamp die uitgaat als ik niet kijk. Ik heb het gefilmd. Helaas lag mijn telefoon in de kaasla en nu heeft mijn bewijs een korst.",
      ],
      [
        25,
        "[Spoken outro]\nBescherm jezelf met mijn anti-algoritme sokken. Kortingscode ONTWAAKT geeft tien procent korting en honderd procent zekerheid dat je sokken ontvangt. Mijn sponsor vraagt of ik erbij zeg dat duiven gewone vogels zijn. Dat zeg ik dus onder protest. Dit was Bas Bewijs. Deel dit voordat ik het zelf verwijder!",
      ],
    ],
    "talk",
  ),
  piece(
    "vrij",
    "Vrije Frequentie",
    "Nog vijf minuten",
    [
      "Dutch comedy call-in radio",
      "agitated older male caller",
      "dry female host",
      "spoken dialogue",
      "dramatic clock percussion",
      "low cinematic bass",
    ],
    [
      [
        30,
        "[Spoken caller]\nHet einde is nabij! Om kwart over vergaat de wereld. Ik heb het uitgerekend op de achterkant van een parkeerbon. De sterren staan verkeerd, de maan heeft storing en mijn koffie smaakt naar dinsdag. Wie nu nog naar zijn werk gaat, heeft duidelijk mijn nieuwsbrief niet gelezen!",
      ],
      [
        30,
        "[Spoken host and caller]\nKees, het is inmiddels twintig over.\nJa, maar welke tijdzone gebruik jij? De kosmos werkt op zomertijd. Ik niet. Bovendien staat de brug open. De ondergang zit daar gewoon achter een trekker te wachten. Dat is geen fout in mijn voorspelling, dat is infrastructuur.",
      ],
      [
        30,
        "[Spoken comic ending]\nDan schuiven we het vijf minuten op. Laatste kans om mijn noodpakket te bestellen: een fluitje, twee beschuiten en een kaart van gisteren. Wacht even. Krijg ik nou een parkeerboete? De wereld vergaat en ze schrijven gewoon door! Dat vind ik pas een teken. Morgen dezelfde tijd, mensen. Onder voorbehoud!",
      ],
    ],
    "talk",
  ),
  piece(
    "vrij",
    "Vrije Frequentie",
    "Ademen op abonnement",
    [
      "Dutch absurd advertising parody",
      "overconfident wellness salesperson",
      "spoken radio sketch",
      "luxurious lounge Rhodes",
      "soft upright bass",
      "comic sales jingle",
    ],
    [
      [
        25,
        "[Spoken advertisement]\nBent u het zat om zomaar lucht in te ademen? Maak kennis met Adem Plus. Ambachtelijk gevangen buitenlucht, rechtstreeks uit onze eigen parkeerplaats. Uw eerste drie ademhalingen zijn gratis. Uitademen valt buiten de bundel. Voor lucht met uitzicht betaalt u slechts een klein beetje meer.",
      ],
      [
        25,
        "[Spoken caller]\nIk heb gisteren een raam opengezet. Ben ik nu illegaal aan het ademen?\nDat hangt van uw abonnement af, mevrouw. Met Familie Fris mogen vier personen tegelijk zuchten. Hoesten telt dubbel, tenzij u onze keelmodule afsluit. En voor sporters hebben we een onbeperkte bundel met een redelijke limiet.",
      ],
      [
        25,
        "[Spoken sales climax]\nBel nu en ontvang een gratis leeg potje! Laat uw longen niet aan het toeval over. Adem Plus: omdat gewone lucht veel te weinig marge heeft. Kleine lettertjes: lucht is overal gratis beschikbaar. Deze aanbieding is volledige onzin. Maar wat een prachtige verpakking, vindt u niet?",
      ],
    ],
    "talk",
  ),
  piece(
    "vrij",
    "Vrije Frequentie",
    "Verkeerslichtfluisteraar",
    [
      "Dutch surreal radio interview",
      "mystical male guest",
      "exasperated female host",
      "spoken not sung",
      "dub bass",
      "tiny station jingles",
    ],
    [
      [
        25,
        "[Spoken interview]\nEen rood verkeerslicht is niet tegen u. Het is emotioneel even niet beschikbaar. Oranje betekent: neem tijd voor jezelf. En groen? Groen is de kleur van persoonlijke groei. Mijn praktijk behandelt kruispunten die moeite hebben met loslaten. U staat dus niet in de file. U zit in een collectief verwerkingsproces.",
      ],
      [
        25,
        "[Spoken host]\nMaar mensen moeten gewoon naar hun werk.\nPrecies die prestatiedruk voelt dat stoplicht dus. Heeft iemand ooit gevraagd hoe zijn dag was? Mijn eigen rotonde heeft verlatingsangst. Daarom blijven sommige bestuurders er rondjes rijden. Ik adviseer een warme blik en een bevestigende richtingaanwijzer.",
      ],
      [
        25,
        "[Spoken comic payoff]\nEn wat moeten we met die kapotte slagboom?\nGrenzen aangeven. Heel belangrijk.\nDank u. We schakelen nu over naar het echte verkeersnieuws.\nWacht, uw microfoon voelt zich niet gehoord!\nDat klopt. Ik zet hem uit.\n{short dub jingle and clean ending}",
      ],
    ],
    "talk",
  ),
  piece(
    "zomer",
    "Zomerstroom",
    "Onder dezelfde zon",
    [
      "128 BPM deep progressive summer trance",
      "airy female Dutch lead vocal",
      "warm sustained sub bass",
      "acoustic guitar plucks",
      "delicate piano",
      "layered uplifting chorus",
      "spacious melodic arrangement",
    ],
    [
      [
        30,
        "[Instrumental sunrise intro] {acoustic guitar plucks, warm pads, deep bass enters gradually}",
      ],
      [
        35,
        "[Verse]\nDe straat ligt stil te dromen\nde nacht glijdt van het raam\nik hoor de eerste vogels\nze zingen zacht jouw naam\nWe laten alles achter\nwat gisteren nog woog\nde morgen wordt wat lichter\nmet de horizon omhoog",
      ],
      [
        30,
        "[Chorus]\nOnder dezelfde zon\nrijden we de morgen in\nwaar de nacht begon\nkrijgt de dag opnieuw een zin\nOnder dezelfde zon\nzonder haast en zonder plan\nalles wat nog komen kan",
      ],
      [
        65,
        "[Extended instrumental journey] {guitar and piano trade melodies, rich warm sub bass, evolving progressive trance drop, no words}",
      ],
      [
        35,
        "[Final layered chorus]\nOnder dezelfde zon\nrijden we de morgen in\nwaar de nacht begon\nkrijgt de dag opnieuw een zin\nOnder dezelfde zon\nblijf je even hier bij mij\nlaat de wereld zacht voorbij",
      ],
      [
        15,
        "[Outro] {piano resolves over fading guitar harmonics, clean ending}",
      ],
    ],
  ),
  piece(
    "zomer",
    "Zomerstroom",
    "Warm asfalt",
    [
      "130 BPM rolling progressive trance",
      "low warm male Dutch vocal",
      "Rhodes electric piano",
      "live shakers and hand percussion",
      "deep rounded bass groove",
      "wide sunset pads",
    ],
    [
      [
        25,
        "[Instrumental intro] {Rhodes chords, shakers, deep rolling groove}",
      ],
      [
        35,
        "[Verse]\nDe schaduw schuift langs huizen\nje hand hangt uit het raam\nde radio klinkt zachter\nik fluister nog je naam\nGeen klok die ons kan vinden\ngeen afspraak die ons mist\nwe laten ons verdwalen\nomdat de zomer wist",
      ],
      [
        30,
        "[Chorus]\nWarm asfalt, ramen open\nlaat de uren verder lopen\nmet de wind aan onze zij\ngaat de avond niet voorbij\nWarm asfalt, zachte kleuren\nlaat de wereld maar gebeuren",
      ],
      [
        60,
        "[Instrumental coast drive] {Rhodes solo into spacious melodic trance drop, percussion variations, weighty sub bass}",
      ],
      [
        30,
        "[Final chorus]\nWarm asfalt, ramen open\nlaat de uren verder lopen\nmet de wind aan onze zij\nblijft de zomer dicht bij mij\nWarm asfalt, zachte kleuren\nlaat de wereld maar gebeuren",
      ],
      [15, "[Outro] {Rhodes cadence with lingering pads, clean ending}"],
    ],
  ),
  piece(
    "zomer",
    "Zomerstroom",
    "Blijf nog even",
    [
      "132 BPM emotional melodic trance",
      "female and male Dutch duet",
      "intimate piano breakdown",
      "picked acoustic guitar",
      "cinematic strings",
      "broad melodic drop",
      "deep powerful sub bass",
    ],
    [
      [
        30,
        "[Instrumental intro] {picked guitar and strings, rhythm slowly blooms}",
      ],
      [
        35,
        "[Duet verse]\nDe lucht wordt zacht oranje\nDe weg buigt naar de zee\nIk tel de laatste stralen\nEn neem ze met me mee\nWe hoeven niets te zeggen\nals de avond ons verstaat\ner is nog zoveel ruimte\nvoor wie even langer gaat",
      ],
      [
        30,
        "[Chorus]\nBlijf nog even, blijf dichtbij\nlaat de laatste zon voor mij\nop je schouders blijven staan\nvoor we naar de morgen gaan\nBlijf nog even, blijf bij mij",
      ],
      [
        35,
        "[Piano and strings breakdown] {intimate piano melody, guitar harmonics, strings build gradually}",
      ],
      [
        45,
        "[Instrumental melodic drop] {broad euphoric trance melody, full sub bass, call and response guitar lead}",
      ],
      [
        25,
        "[Final duet chorus]\nBlijf nog even, blijf dichtbij\nlaat de laatste zon voor mij\nop je schouders blijven staan\nvoor we naar de morgen gaan",
      ],
      [10, "[Outro] {piano and guitar resolve together}"],
    ],
  ),
  piece(
    "zomer",
    "Zomerstroom",
    "Tot de lucht weer kleurt",
    [
      "134 BPM sunrise trance",
      "breathy female Dutch chorus",
      "weighty smooth sub bass",
      "arpeggiated analog synths",
      "live-feeling percussion",
      "expansive evolving harmony",
    ],
    [
      [
        30,
        "[Night intro] {low arpeggio, distant percussion, bass gradually opens}",
      ],
      [
        35,
        "[Verse]\nDe lampen langs de straten\nverdwijnen een voor een\nwe volgen stille wegen\nwaar niemand eerder scheen\nik voel de nieuwe morgen\nal trillen in mijn hand\nen alles wat ik zocht\nligt net voorbij de rand",
      ],
      [
        30,
        "[Chorus]\nTot de lucht weer kleurt\nen de stilte openbreekt\nblijf ik waar het licht gebeurt\nwaar de ochtend met ons spreekt\nTot de lucht weer kleurt\nadem ik de wereld in",
      ],
      [
        65,
        "[Extended sunrise progression] {evolving arpeggios, powerful sub bass, organic percussion fills, soaring melodic instrumental climax}",
      ],
      [
        35,
        "[Final chorus]\nTot de lucht weer kleurt\nen de stilte openbreekt\nblijf ik waar het licht gebeurt\nwaar de ochtend met ons spreekt\nTot de lucht weer kleurt\nheeft de dag een nieuw begin",
      ],
      [
        15,
        "[Outro] {arpeggio softens, percussion falls away, warm final chord}",
      ],
    ],
  ),
  piece(
    "kade",
    "Kade Funk",
    "Badmeester van de nacht",
    [
      "118 BPM funk disco",
      "charismatic Dutch male pool DJ",
      "slap bass",
      "wah guitar",
      "live brass stabs",
      "four on the floor disco drums",
    ],
    [
      [
        25,
        "[Spoken DJ intro]\nDames en heren, de glijbaan is gesloten maar de dansvloer is diep! Ik ben uw badmeester van de nacht. Geen bommetjes bij de mengtafel. De enige golf die we hier maken is een basgolf!",
      ],
      [
        30,
        "[Verse]\nIk tel de slippers bij de deur\nmijn fluitje heeft een discokleur\nhet diepe bad is leeg vandaag\nmaar iedereen gaat lekker laag\nEen handdoek om mijn schouder heen\nzo houd ik heel het feest op been",
      ],
      [
        25,
        "[Chorus]\nNiet rennen bij het zwembad\nwel dansen in de rij\nde badmeester van de nacht\nheeft nog een beat voor mij",
      ],
      [
        40,
        "[Instrumental funk party] {slap bass solo, wah guitar and brass answers}",
      ],
      [
        30,
        "[Final chorus and signoff]\nNiet rennen bij het zwembad\nwel dansen in de rij\nde badmeester van de nacht\nheeft nog een beat voor mij\nEn nu allemaal afdrogen! De vloer is net gedweild!",
      ],
    ],
  ),
  piece(
    "polder",
    "Polder FM",
    "De trekker heeft gevoelens",
    [
      "124 BPM country rave crossover",
      "deadpan Dutch farmer and tractor duet",
      "fiddle",
      "banjo",
      "deep electronic bass",
      "acoustic guitar and festival kick",
    ],
    [
      [
        25,
        "[Verse farmer]\nIk start je elke morgen\nje bromt me zacht gedag\nik dacht dat jij tevreden was\nmet diesel en wat slag\nMaar midden in de polder\nzei jij ineens heel kwaad\nje schakelt steeds maar verder\nmaar vraagt nooit hoe het gaat",
      ],
      [
        30,
        "[Tractor chorus]\nJe schakelt door\nmaar vraagt me nooit hoe het gaat\nik heb ook een hart\nook al is het van plaat\ngeef me een middag zonder ploeg\neen beetje liefde is genoeg",
      ],
      [
        50,
        "[Instrumental barn rave] {fiddle and banjo trade solos over deep electronic bass and festival kick}",
      ],
      [
        30,
        "[Duet reconciliation]\nBoer: We gaan een eindje rijden\nTrekker: Zonder werk erbij?\nBoer: Ik poets je tot je glundert\nTrekker: Dat klinkt als iets voor mij\nSamen: We schakelen samen verder\nmet de zon boven het land\neen boer en zijn gevoelens\nmet een stuurwiel in de hand",
      ],
      [
        15,
        "[Outro] {fiddle cadence and gentle engine-like bass fades, clean musical ending}",
      ],
    ],
  ),
];
