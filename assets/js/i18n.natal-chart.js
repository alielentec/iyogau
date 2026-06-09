/* =====================================================================
 *  i18n.natal-chart.js
 *  ---------------------------------------------------------------------
 *  Natal-chart-specific i18n keys.
 *
 *  Why a sibling file rather than appended to /assets/js/i18n.js?
 *    The base i18n dictionary is shared with every page on the site and
 *    its structure (loaders, default-language handling, etc.) is owned
 *    by the marketing pages. Keeping tool-specific keys in their own
 *    file means we never risk breaking those pages.
 *
 *  This script must run AFTER /assets/js/i18n.js (HTML loads them in
 *  that order). It deep-merges the natal-chart keys into the existing
 *  dictionary, falling back to creating a fresh dictionary if the base
 *  file has not run for any reason.
 *
 *  Translation status:
 *    en — final.
 *    ko — drafted using standard Korean astrological terms. Items
 *         marked `TODO native-review` need confirmation from a native
 *         Korean Jyotisha practitioner before launch.
 *    zh — drafted using standard Chinese (Simplified) astrological terms.
 *         Items marked `TODO native-review` need confirmation from a
 *         native Chinese Jyotisha practitioner before launch.
 * ===================================================================== */

(function () {
  'use strict';

  function deepMerge(target, source) {
    if (!source) return target;
    Object.keys(source).forEach(function (k) {
      if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
        if (!target[k] || typeof target[k] !== 'object') target[k] = {};
        deepMerge(target[k], source[k]);
      } else {
        target[k] = source[k];
      }
    });
    return target;
  }

  var bundle = {
    en: {
      natal: {
        header: { back: '← Back to iYogaU' },
        title: 'Your Free Vedic Natal Chart',
        subtitle: 'A sidereal birth chart in the classical Jyotisha tradition — computed instantly, with no birth details stored on our servers.',
        intro: 'Enter the date, time, and place of your birth. We use the Lahiri ayanamsa and the whole-sign house system, the conventions used in classical yoga training.',
        form: {
          heading: 'Birth details',
          name: 'Your name (optional)',
          'name.help': 'For your reference only — not sent to our server.',
          steveJobsNote: 'Currently showing Steve Jobs’s chart. Edit any field below and your own chart will appear in the Natal Chart tab.',
          date: 'Birth date',
          time: 'Birth time',
          'time.unknown': 'I don’t know my birth time',
          place: 'Birthplace',
          'place.help': 'Type a city name. We match against a built-in gazetteer — no third-party lookup.',
          'place.empty': 'No matches. Try a larger nearby city.',
          tz: 'Timezone',
          'tz.adjust': 'adjust',
          lat: 'Latitude',
          lon: 'Longitude',
          'tz.offset.enable': 'Use custom UTC offset instead',
          'tz.offset': 'UTC offset (±HH:MM)',
          adjust: {
            legend: 'Fine-tune location (optional)',
            help: 'Auto-filled from the city you picked. Adjust if needed.'
          },
          consent: 'I consent to processing my birth details (date, time, place) for this natal chart calculation.',
          'consent.link': 'See our Privacy Policy.',
          submit: 'Calculate Natal Chart',
          submitting: 'Calculating…',
          error: {
            required: 'Please complete every required field, including consent.',
            api: 'Sorry — we could not compute your chart. Please check your details and try again.'
          }
        },
        tabs: {
          input: 'Input Data',
          chart: 'Natal Chart',
          planets: 'Planet Positions',
          aspects: 'Major Aspects',
          relocation: 'Relocation',
          immigration: 'Immigration',
          soulmate: 'Soulmate'
        },
        astrocarto: {
          loading: 'Computing astrocartography map…',
          error: 'Sorry — we could not load the astrocartography map. Please try again.',
          errorUnknownTime: 'Astrocartography needs your birth time. Please enter your exact birth time above to see this map.',
          errorNoSource: 'Please calculate your natal chart first — the map needs your birth details.',
          relocation: { intro: 'Places where the planets that support stability, visibility, and growth in your chart amplify their effects. Warmer cells mark stronger zones; lines mark exact angular activation.' },
          immigration: { intro: 'Places that support foreign movement, paperwork endurance, and settlement. Rahu, Saturn, and Jupiter lead this lens; warmer cells indicate where the transition can take root.' },
          soulmate:    { intro: 'Places that favor partnership and meeting: where Venus, the Moon, and Jupiter lines run close to angular points. Warmer cells mark zones of relationship resonance.' },
          tabs: { relocation: 'Relocation', immigration: 'Immigration', soulmate: 'Soulmate' },
          legend: {
            planets: 'Planets',
            lines: 'Lines',
            heat: 'Heat scale',
            heatLabels: 'Lower ▸ Higher'
          },
          lineTypes: {
            mc: 'MC', ic: 'IC', ac: 'AC', dc: 'DC',
            mcLong: 'MC (career)',
            icLong: 'IC (home)',
            acLong: 'AC (self)',
            dcLong: 'DC (partners)'
          },
          tooltip: {
            score: 'Score',
            topLines: 'Top contributing lines',
            noLines: 'No major lines nearby'
          }
        },
        section: {
          editedIntro: 'The chart below is computed from your birth details. The calculator runs sidereal Vedic math on our server and your details are never stored, sold, or sent anywhere else.'
        },
        results: {
          heading: 'Your sidereal natal chart',
          defaultCaption: 'Currently showing: Steve Jobs · 24 Feb 1955 · San Francisco',
          defaultName: 'Steve Jobs',
          placeFallback: 'your chart',
          steveJobsAttrib: 'Steve Jobs birth data: Astro-Databank, AA-rated.',
          aspectsEmpty: 'No major aspects within standard orbs for this chart.',
          ascendant: 'Ascendant',
          midheaven: 'Midheaven',
          planets: 'Planet positions',
          planetCol: 'Planet',
          signCol: 'Sign',
          degreeCol: 'Degree',
          houseCol: 'House',
          aspects: 'Major aspects',
          aspectFrom: 'From',
          aspectType: 'Aspect',
          aspectTo: 'To',
          aspectOrb: 'Orb',
          siderealLabel: 'Sidereal (Vedic)',
          ayanamsaLabel: 'Ayanamsa',
          housesLabel: 'Houses'
        },
        signs: {
          aries: 'Aries', taurus: 'Taurus', gemini: 'Gemini', cancer: 'Cancer',
          leo: 'Leo', virgo: 'Virgo', libra: 'Libra', scorpio: 'Scorpio',
          sagittarius: 'Sagittarius', capricorn: 'Capricorn',
          aquarius: 'Aquarius', pisces: 'Pisces'
        },
        planets: {
          sun: 'Sun', moon: 'Moon', mercury: 'Mercury', venus: 'Venus',
          mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn',
          uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto'
        },
        aspects: {
          conjunction: 'Conjunction', sextile: 'Sextile',
          square: 'Square', trine: 'Trine', opposition: 'Opposition'
        },
        // Famous-people picker. Display strings only — the numeric
        // birth-data snapshot (lat/lon/tz/date/time/source) lives in
        // /assets/js/natal-presets.js. Adding a new preset means
        // adding it to the JS module AND adding name/placeLabel/blurb
        // here for every language. Keys mirror the preset `id` value.
        presets: {
          legendHeading: 'Or pick a famous person',
          legendHelp: 'Loads a published natal chart. Edit any birth field to clear and use your own data.',
          placeholder: 'Steve Jobs',
          currentlyShowing: "Currently showing {name}'s chart. Edit any field below and your own chart will appear in the Natal Chart tab.",
          attribution: '{name} birth data: {source}',
          ratingWarning: 'Time unreliable ({rating}-rated) — chart shown for reference; Ascendant and houses may not be accurate.',
          ratingWarningX: 'Time unknown (X-rated) — only date/sun/moon positions are reliable; Ascendant, houses, and rising chart are NOT astrologically valid for this preset.',
          'steve-jobs': {
            name: 'Steve Jobs',
            placeLabel: 'San Francisco, United States',
            blurb: "Apple co-founder; long-time Zen Buddhist practitioner; 1974 pilgrimage to Neem Karoli Baba's ashram in India"
          },
          'donald-trump': {
            name: 'Donald Trump',
            placeLabel: 'Queens, New York, United States',
            blurb: '45th and 47th President of the United States; real-estate businessman and television personality'
          },
          'elon-musk': {
            name: 'Elon Musk',
            placeLabel: 'Pretoria, South Africa',
            blurb: 'Tesla / SpaceX founder; CEO of X; one of the most-followed figures in modern technology'
          },
          'jeff-bezos': {
            name: 'Jeff Bezos',
            placeLabel: 'Albuquerque, New Mexico, United States',
            blurb: 'Amazon founder; Blue Origin founder; long-time investor in space technology'
          },
          'mark-zuckerberg': {
            name: 'Mark Zuckerberg',
            placeLabel: 'White Plains, New York, United States',
            blurb: 'Meta (Facebook) co-founder and CEO; computer programmer and businessman'
          },
          'michael-jackson': {
            name: 'Michael Jackson',
            placeLabel: 'Gary, Indiana, United States',
            blurb: 'King of Pop; singer, songwriter, dancer; cultural icon of the late 20th century'
          },
          'michael-jordan': {
            name: 'Michael Jordan',
            placeLabel: 'Brooklyn, New York, United States',
            blurb: 'Six-time NBA champion; widely considered the greatest basketball player of all time'
          },
          'taylor-swift': {
            name: 'Taylor Swift',
            placeLabel: 'West Reading, Pennsylvania, United States',
            blurb: 'Singer-songwriter; 14-time Grammy winner; defining pop / country crossover artist'
          },
          'cristiano-ronaldo': {
            name: 'Cristiano Ronaldo',
            placeLabel: 'Funchal, Madeira, Portugal',
            blurb: 'Portuguese footballer; five-time Ballon d’Or winner; all-time top international goal-scorer'
          },
          'shakira': {
            name: 'Shakira',
            placeLabel: 'Barranquilla, Colombia',
            blurb: 'Colombian singer-songwriter; trilingual recording artist; Latin music icon'
          },
          'diego-maradona': {
            name: 'Diego Maradona',
            placeLabel: 'Lanús, Buenos Aires, Argentina',
            blurb: 'Argentine footballer; 1986 World Cup winner; widely regarded as one of the greatest of all time'
          },
          'roberto-carlos': {
            name: 'Roberto Carlos',
            placeLabel: 'Garça, São Paulo, Brazil',
            blurb: 'Brazilian footballer; 2002 World Cup winner; legendary left-back famous for his free-kick technique'
          },
          'albert-einstein': {
            name: 'Albert Einstein',
            placeLabel: 'Ulm, Germany',
            blurb: 'Theoretical physicist; deep interest in Spinoza, Indian philosophy, and the unity of natural law'
          },
          'thomas-edison': {
            name: 'Thomas Edison',
            placeLabel: 'Milan, Ohio, United States',
            blurb: 'American inventor and businessman; phonograph, motion-picture camera, practical incandescent light bulb'
          }
        }
      }
    },

    ko: {
      natal: {
        header: { back: '← iYogaU로 돌아가기' },
        title: '무료 베다 출생 차트',
        subtitle: '고전 주이티쉬(Jyotisha) 전통의 항성(sidereal) 출생 차트 — 서버에 출생 정보를 저장하지 않고 즉시 계산해 드립니다.',
        intro: '생년월일, 출생 시각, 출생지를 입력하세요. 라히리 아야난사(Lahiri ayanamsa)와 함께 전스타일 사인(whole-sign) 하우스 시스템을 사용합니다.',
        form: {
          heading: '출생 정보',
          name: '이름 (선택)',
          'name.help': '참고용입니다 — 서버로 전송되지 않습니다.',
          steveJobsNote: '현재 스티브 잡스의 차트를 표시 중입니다. 아래 항목을 수정하면 베다 차트 탭에 본인의 차트가 표시됩니다.',
          date: '출생일',
          time: '출생 시각',
          'time.unknown': '출생 시각을 모릅니다',
          place: '출생지',
          'place.help': '도시 이름을 입력하세요. 내장 데이터베이스에서 검색하며 외부 서비스를 사용하지 않습니다.',
          'place.empty': '일치하는 도시가 없습니다. 인근의 더 큰 도시를 입력해 보세요.',
          tz: '시간대',
          'tz.adjust': '수정',
          lat: '위도',
          lon: '경도',
          'tz.offset.enable': '사용자 지정 UTC 오프셋 사용',
          'tz.offset': 'UTC 오프셋 (±HH:MM)',
          adjust: {
            legend: '위치 세부 조정 (선택 사항)',
            help: '선택하신 도시를 기반으로 자동 입력됩니다. 필요하면 직접 조정하세요.'
          },
          consent: '이 출생 차트 계산을 위해 내 출생 정보(날짜, 시각, 장소)의 처리에 동의합니다.',
          'consent.link': '개인정보 처리방침 보기',
          submit: '출생 차트 계산하기',
          submitting: '계산 중…',
          error: {
            required: '동의를 포함해 필수 항목을 모두 입력해 주세요.',
            api: '죄송합니다. 차트를 계산할 수 없었습니다. 입력 정보를 확인하고 다시 시도해 주세요.'
          }
        },
        tabs: {
          input: '입력 데이터',
          chart: '베다 차트',
          planets: '행성 위치',
          aspects: '주요 각도',
          relocation: '이주',
          immigration: '이민',
          soulmate: '소울메이트'
        },
        astrocarto: {
          loading: '점성지리도(astrocartography) 지도를 계산하는 중…',
          error: '죄송합니다. 점성지리도 지도를 불러올 수 없습니다. 다시 시도해 주세요.',
          errorUnknownTime: '점성지리도에는 정확한 출생 시각이 필요합니다. 위에 출생 시각을 입력하면 이 지도가 표시됩니다.',
          errorNoSource: '먼저 출생 차트를 계산해 주세요. 지도를 그리려면 출생 정보가 필요합니다.',
          relocation: { intro: '안정, 가시성, 성장에 도움이 되는 행성의 영향이 강해지는 장소들입니다. 따뜻한 색상의 셀일수록 강한 구역이며, 선은 정확한 각도 활성화를 표시합니다.' },
          immigration: { intro: '해외 이주, 행정 절차의 인내, 정착을 돕는 장소들입니다. 라후·토성·목성이 이 렌즈를 이끌며, 따뜻한 색상의 셀은 이주가 자리잡기 좋은 곳을 나타냅니다.' },
          soulmate:    { intro: '관계와 만남에 유리한 장소들입니다. 금성·달·목성의 선이 각점(angular points) 가까이를 지나는 곳이며, 따뜻한 색상의 셀은 관계 공명의 구역을 표시합니다.' },
          tabs: { relocation: '이주', immigration: '이민', soulmate: '소울메이트' },
          legend: {
            planets: '행성',
            lines: '라인',
            heat: '강도 척도',
            heatLabels: '낮음 ▸ 높음'
          },
          lineTypes: {
            mc: 'MC', ic: 'IC', ac: 'AC', dc: 'DC',
            mcLong: 'MC (직업)',
            icLong: 'IC (집)',
            acLong: 'AC (자신)',
            dcLong: 'DC (파트너)'
          },
          tooltip: {
            score: '점수',
            topLines: '주요 기여 라인',
            noLines: '근처에 주요 라인 없음'
          }
        },
        section: {
          editedIntro: '아래 차트는 입력하신 출생 정보로 계산되었습니다. 계산은 시데레알(베다) 방식으로 서버에서 수행되며, 입력하신 정보는 저장·판매·전송되지 않습니다.'
        },
        results: {
          heading: '당신의 베다 출생 차트',
          defaultCaption: '현재 표시: 스티브 잡스 · 1955년 2월 24일 · 샌프란시스코',
          defaultName: '스티브 잡스',
          placeFallback: '귀하의 차트',
          steveJobsAttrib: '스티브 잡스 출생 정보: Astro-Databank, AA 등급.',
          aspectsEmpty: '표준 오브 범위 내에 주요 각도가 없습니다.',
          ascendant: '상승궁 (Asc)',
          midheaven: '천정 (MC)',
          planets: '행성 위치',
          planetCol: '행성',
          signCol: '궁',
          degreeCol: '도',
          houseCol: '하우스',
          aspects: '주요 애스펙트',
          aspectFrom: '이름',
          aspectType: '애스펙트',
          aspectTo: '대상',
          aspectOrb: '오브',
          siderealLabel: '항성 (베다)',
          ayanamsaLabel: '아야난사',
          housesLabel: '하우스 시스템'
        },
        signs: {
          aries: '양자리',
          taurus: '황소자리',
          gemini: '쌍둥이자리',
          cancer: '게자리',
          leo: '사자자리',
          virgo: '처녀자리',
          libra: '천칭자리',
          scorpio: '전갈자리',
          sagittarius: '궁수자리',
          capricorn: '염소자리',
          aquarius: '물병자리',
          pisces: '물고기자리'
        },
        planets: {
          // Common Korean astronomical names. TODO native-review:
          // confirm whether Jyotisha pedagogy prefers transliterated
          // Sanskrit (수리야, 차드라, ...) for
          // students who already know the Vedic terms.
          sun:     '태양',     // TODO native-review
          moon:    '달',           // TODO native-review
          mercury: '수성',
          venus:   '금성',
          mars:    '화성',
          jupiter: '목성',
          saturn:  '토성',
          uranus:  '천왕성',
          neptune: '해왕성',
          pluto:   '명왕성'
        },
        aspects: {
          conjunction: '합 (Conjunction)',     // TODO native-review
          sextile:     '육분상 (Sextile)',
          square:      '사분상 (Square)',
          trine:       '삼분상 (Trine)',
          opposition:  '웅 (Opposition)'        // TODO native-review
        },
        presets: {
          legendHeading: '또는 유명 인물 선택',
          legendHelp: '공개된 출생 차트를 불러옵니다. 출생 정보를 수정하면 본인 데이터로 전환됩니다.',
          placeholder: '스티브 잡스',
          currentlyShowing: '현재 {name}의 차트를 표시 중입니다. 아래 항목을 수정하면 베다 차트 탭에 본인의 차트가 표시됩니다.',
          attribution: '{name} 출생 정보: {source}',
          ratingWarning: '출생 시각 신뢰도 낮음 ({rating}등급) — 참고용 차트입니다. 어센던트 및 하우스 정보가 정확하지 않을 수 있습니다.',
          ratingWarningX: '출생 시각 미상 (X등급) — 날짜·태양·달의 위치만 신뢰할 수 있습니다. 어센던트, 하우스, 상승 차트는 이 프리셋에 대해 천문학적으로 유효하지 않습니다.',
          'steve-jobs': {
            name: '스티브 잡스',
            placeLabel: '샌프란시스코, 미국',
            blurb: '애플 공동 창업자; 오랜 선불교 수행자; 1974년 인도의 님 카롤리 바바 아쉬람을 순례'
          },
          'donald-trump': {
            name: '도널드 트럼프',
            placeLabel: '퀸스, 뉴욕, 미국',
            blurb: '미국 제45·47대 대통령; 부동산 사업가이자 텔레비전 진행자'
          },
          'elon-musk': {
            name: '일론 머스크',
            placeLabel: '프리토리아, 남아프리카 공화국',
            blurb: '테슬라·스페이스X 창업자; X(구 트위터) CEO; 현대 기술계의 가장 영향력 있는 인물 중 한 명'
          },
          'jeff-bezos': {
            name: '제프 베이조스',
            placeLabel: '앨버커키, 뉴멕시코, 미국',
            blurb: '아마존 창업자; 블루 오리진 창업자; 우주 기술 분야의 장기 투자자'
          },
          'mark-zuckerberg': {
            name: '마크 저커버그',
            placeLabel: '화이트 플레인스, 뉴욕, 미국',
            blurb: '메타(페이스북) 공동 창업자 겸 CEO; 컴퓨터 프로그래머이자 기업가'
          },
          'michael-jackson': {
            name: '마이클 잭슨',
            placeLabel: '게리, 인디애나, 미국',
            blurb: '"팝의 황제"; 가수·작곡가·댄서; 20세기 후반 문화의 아이콘'
          },
          'michael-jordan': {
            name: '마이클 조던',
            placeLabel: '브루클린, 뉴욕, 미국',
            blurb: 'NBA 6회 우승; 역사상 가장 위대한 농구 선수로 평가받음'
          },
          'taylor-swift': {
            name: '테일러 스위프트',
            placeLabel: '웨스트 리딩, 펜실베이니아, 미국',
            blurb: '싱어송라이터; 그래미 14회 수상; 팝과 컨트리를 잇는 대표 아티스트'
          },
          'cristiano-ronaldo': {
            name: '크리스티아누 호날두',
            placeLabel: '푼샬, 마데이라, 포르투갈',
            blurb: '포르투갈 축구 선수; 발롱도르 5회 수상; 국가대표 통산 최다 득점자'
          },
          'shakira': {
            name: '샤키라',
            placeLabel: '바랑키야, 콜롬비아',
            blurb: '콜롬비아 싱어송라이터; 다국어로 활동하는 아티스트; 라틴 음악의 아이콘'
          },
          'diego-maradona': {
            name: '디에고 마라도나',
            placeLabel: '라누스, 부에노스아이레스, 아르헨티나',
            blurb: '아르헨티나 축구 선수; 1986년 월드컵 우승; 역사상 최고의 선수 중 한 명'
          },
          'roberto-carlos': {
            name: '호베르투 카를루스',
            placeLabel: '가르사, 상파울루, 브라질',
            blurb: '브라질 축구 선수; 2002년 월드컵 우승; 강력한 프리킥으로 유명한 전설적인 왼쪽 풀백'
          },
          'albert-einstein': {
            name: '알베르트 아인슈타인',
            placeLabel: '울름, 독일',
            blurb: '이론 물리학자; 스피노자, 인도 철학, 자연 법칙의 통일성에 깊은 관심'
          },
          'thomas-edison': {
            name: '토머스 에디슨',
            placeLabel: '밀란, 오하이오, 미국',
            blurb: '미국의 발명가 겸 기업가; 축음기·영사기·실용적 백열전구의 발명자'
          }
        }
      }
    },

    zh: {
      natal: {
        header: { back: '← 返回 iYogaU' },
        title: '免费吐吃师出生星盘',  // TODO native-review: 吐吃师 vs 吐吃迦 transliteration choice
        subtitle: '古典 Jyotisha 传统的恒星（sidereal）出生星盘 — 即时计算，出生资料不会存储在我们的服务器上。',
        intro: '请输入您的出生日期、时间与地点。我们使用 Lahiri 岁差（ayanamsa）以及整宫制（whole-sign）宫位系统，这是古典瑜伽训练中使用的约定。',
        form: {
          heading: '出生资料',
          name: '姓名（选填）',
          'name.help': '仅供您参考 — 不会发送到我们的服务器。',
          steveJobsNote: '当前显示的是史蒂夫·乔布斯的星盘。修改下面任意字段后，您自己的星盘将出现在"吠陀星盘"标签页。',
          date: '出生日期',
          time: '出生时间',
          'time.unknown': '我不知道自己的出生时间',
          place: '出生地点',
          'place.help': '输入城市名称。我们使用内置数据库检索，不连接第三方服务。',
          'place.empty': '未找到匹配项。请尝试较大的附近城市。',
          tz: '时区',
          'tz.adjust': '调整',
          lat: '纬度',
          lon: '经度',
          'tz.offset.enable': '改用自定义 UTC 偏移',
          'tz.offset': 'UTC 偏移 (±HH:MM)',
          adjust: {
            legend: '微调位置（可选）',
            help: '根据您选择的城市自动填充。如需调整请修改。'
          },
          consent: '我同意为了本次出生星盘计算而处理我的出生资料（日期、时间、地点）。',
          'consent.link': '查看隐私政策',
          submit: '计算出生星盘',
          submitting: '正在计算…',
          error: {
            required: '请填写所有必填项目并勾选同意项。',
            api: '抱歉 — 无法计算您的星盘。请检查资料后重试。'
          }
        },
        tabs: {
          input: '输入数据',
          chart: '吠陀星盘',
          planets: '行星位置',
          aspects: '主要相位',
          relocation: '迁居',
          immigration: '移民',
          soulmate: '灵魂伴侣'
        },
        astrocarto: {
          loading: '正在计算占星地理（astrocartography）地图…',
          error: '抱歉 — 无法加载占星地理地图，请重试。',
          errorUnknownTime: '占星地理地图需要您的确切出生时间。请在上方输入出生时间以查看此地图。',
          errorNoSource: '请先计算您的出生星盘 — 地图需要您的出生资料。',
          relocation: { intro: '在您星盘中支持稳定、能见度与成长的行星在这些地方影响最强。颜色越暖的格子代表越强区域；线条标示精确的角度激活位置。' },
          immigration: { intro: '有助于跨国迁徙、办理手续与定居的地方。罗睺、土星与木星主导此视角；颜色更暖的格子表示更易扎根之处。' },
          soulmate:    { intro: '有利于伴侣关系与相遇的地方：金星、月亮与木星的线条经过角点附近。颜色更暖的格子标示关系共振区域。' },
          tabs: { relocation: '迁居', immigration: '移民', soulmate: '灵魂伴侣' },
          legend: {
            planets: '行星',
            lines: '线条',
            heat: '强度刻度',
            heatLabels: '低 ▸ 高'
          },
          lineTypes: {
            mc: 'MC', ic: 'IC', ac: 'AC', dc: 'DC',
            mcLong: 'MC（事业）',
            icLong: 'IC（家庭）',
            acLong: 'AC（自我）',
            dcLong: 'DC（伴侣）'
          },
          tooltip: {
            score: '分数',
            topLines: '主要贡献线条',
            noLines: '附近无主要线条'
          }
        },
        section: {
          editedIntro: '下方星盘是根据您输入的出生信息计算的。计算采用恒星黄道（吠陀）方法在我们服务器上完成，您输入的信息不会被保存、出售或转发给任何第三方。'
        },
        results: {
          defaultCaption: '当前显示：史蒂夫·乔布斯 · 1955 年 2 月 24 日 · 旧金山',
          defaultName: '史蒂夫·乔布斯',
          placeFallback: '您的星盘',
          steveJobsAttrib: '史蒂夫·乔布斯出生数据：Astro-Databank，AA 级。',
          aspectsEmpty: '本星盘在标准容许度内没有主要相位。',
          heading: '您的吐吃师出生星盘',  // TODO native-review
          ascendant: '上升点 (Asc)',
          midheaven: '天顶 (MC)',
          planets: '行星位置',
          planetCol: '行星',
          signCol: '星座',
          degreeCol: '度数',
          houseCol: '宫位',
          aspects: '主要相位',
          aspectFrom: '从',
          aspectType: '相位',
          aspectTo: '至',
          aspectOrb: '容许度',
          siderealLabel: '恒星（吐吃）',  // TODO native-review
          ayanamsaLabel: '岁差值',
          housesLabel: '宫位制'
        },
        signs: {
          aries: '白羊座',
          taurus: '金牛座',
          gemini: '双子座',
          cancer: '巨蟹座',
          leo: '狮子座',
          virgo: '处女座',
          libra: '天秤座',
          scorpio: '天蝎座',
          sagittarius: '射手座',
          capricorn: '摩羯座',
          aquarius: '水瓶座',
          pisces: '双鱼座'
        },
        planets: {
          sun: '太阳',
          moon: '月亮',
          mercury: '水星',
          venus: '金星',
          mars: '火星',
          jupiter: '木星',
          saturn: '土星',
          uranus: '天王星',
          neptune: '海王星',
          pluto: '冥王星'
        },
        aspects: {
          conjunction: '合相',
          sextile: '六分相',
          square: '四分相',
          trine: '三分相',
          opposition: '对相'
        },
        presets: {
          legendHeading: '或选择一位名人',
          legendHelp: '加载已公开的出生星盘。修改任意出生字段即可切换到您自己的数据。',
          placeholder: '史蒂夫·乔布斯',
          currentlyShowing: '当前显示的是 {name} 的星盘。修改下方任意字段，您自己的星盘将出现在"吠陀星盘"标签页。',
          attribution: '{name} 出生数据：{source}',
          ratingWarning: '出生时间不可靠（{rating}级）— 仅供参考，上升点与宫位可能不准确。',
          ratingWarningX: '出生时间未知（X 级）— 只有日期、太阳和月亮位置可靠。上升点、宫位与上升星图对该预设而言在占星学上无效。',
          'steve-jobs': {
            name: '史蒂夫·乔布斯',
            placeLabel: '旧金山, 美国',
            blurb: '苹果联合创始人；长期禅宗修行者；1974 年赴印度尼姆·卡罗利·巴巴道场参学'
          },
          'donald-trump': {
            name: '唐纳德·特朗普',
            placeLabel: '皇后区, 纽约, 美国',
            blurb: '美国第 45 任及第 47 任总统；房地产企业家与电视名人'
          },
          'elon-musk': {
            name: '埃隆·马斯克',
            placeLabel: '比勒陀利亚, 南非',
            blurb: '特斯拉、SpaceX 创始人；X（原推特）CEO；当代科技界最具影响力的人物之一'
          },
          'jeff-bezos': {
            name: '杰夫·贝索斯',
            placeLabel: '阿尔伯克基, 新墨西哥州, 美国',
            blurb: '亚马逊创始人；蓝色起源创始人；长期投资航天科技'
          },
          'mark-zuckerberg': {
            name: '马克·扎克伯格',
            placeLabel: '白原市, 纽约, 美国',
            blurb: 'Meta（Facebook）联合创始人兼 CEO；计算机程序员与企业家'
          },
          'michael-jackson': {
            name: '迈克尔·杰克逊',
            placeLabel: '加里, 印第安纳州, 美国',
            blurb: '"流行之王"；歌手、词曲作者、舞者；20 世纪后期的文化偶像'
          },
          'michael-jordan': {
            name: '迈克尔·乔丹',
            placeLabel: '布鲁克林, 纽约, 美国',
            blurb: '六届 NBA 总冠军；公认史上最伟大的篮球运动员'
          },
          'taylor-swift': {
            name: '泰勒·斯威夫特',
            placeLabel: '西雷丁, 宾夕法尼亚州, 美国',
            blurb: '创作型歌手；14 次格莱美奖得主；跨流行与乡村音乐的标志性艺人'
          },
          'cristiano-ronaldo': {
            name: '克里斯蒂亚诺·罗纳尔多',
            placeLabel: '丰沙尔, 马德拉, 葡萄牙',
            blurb: '葡萄牙足球运动员；五届金球奖得主；国家队历史最佳射手'
          },
          'shakira': {
            name: '夏奇拉',
            placeLabel: '巴兰基亚, 哥伦比亚',
            blurb: '哥伦比亚创作型歌手；多语种歌手；拉丁音乐标志性人物'
          },
          'diego-maradona': {
            name: '迭戈·马拉多纳',
            placeLabel: '拉努斯, 布宜诺斯艾利斯, 阿根廷',
            blurb: '阿根廷足球运动员；1986 年世界杯冠军；公认史上最伟大的球员之一'
          },
          'roberto-carlos': {
            name: '罗伯托·卡洛斯',
            placeLabel: '加尔萨, 圣保罗, 巴西',
            blurb: '巴西足球运动员；2002 年世界杯冠军；以强力任意球闻名的传奇左后卫'
          },
          'albert-einstein': {
            name: '阿尔伯特·爱因斯坦',
            placeLabel: '乌尔姆, 德国',
            blurb: '理论物理学家；深研斯宾诺莎、印度哲学与自然法则的统一'
          },
          'thomas-edison': {
            name: '托马斯·爱迪生',
            placeLabel: '米兰, 俄亥俄州, 美国',
            blurb: '美国发明家与企业家；留声机、电影摄影机、实用白炽灯的发明者'
          }
        }
      }
    }
  };

  // Merge into the site-wide dictionary (created here if missing).
  window.IYOGAU_I18N = window.IYOGAU_I18N || {};
  Object.keys(bundle).forEach(function (lang) {
    window.IYOGAU_I18N[lang] = window.IYOGAU_I18N[lang] || {};
    deepMerge(window.IYOGAU_I18N[lang], bundle[lang]);
  });

  // If the base i18n loader has already run and applied data-i18n
  // substitutions, kick it again so the newly-merged keys take effect
  // on this page. We try a few common hook names without assuming any.
  function tryApply() {
    var fns = ['applyI18n', 'applyTranslations', 'translatePage', 'iyogauApplyI18n'];
    for (var i = 0; i < fns.length; i++) {
      var fn = window[fns[i]];
      if (typeof fn === 'function') { try { fn(); return; } catch (e) {} }
    }
    // Fallback: a minimal in-place applier that walks data-i18n attributes.
    // This keeps the page usable even if the base loader uses a different
    // function name or has not yet been wired up.
    var lang = (function () {
      try {
        var p = new URLSearchParams(location.search);
        if (p.get('lang')) return p.get('lang');
      } catch (e) {}
      var h = document.documentElement.getAttribute('lang') || 'en';
      if (h.indexOf('ko') === 0) return 'ko';
      if (h.indexOf('zh') === 0) return 'zh';
      return 'en';
    }());
    var dict = window.IYOGAU_I18N[lang];
    if (!dict) return;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var path = el.getAttribute('data-i18n').split('.');
      var node = dict;
      for (var i = 0; i < path.length; i++) {
        if (node == null) return;
        node = node[path[i]];
      }
      if (typeof node === 'string' && node) el.textContent = node;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryApply);
  } else {
    tryApply();
  }
}());
