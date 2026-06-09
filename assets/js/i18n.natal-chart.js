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
          aspects: 'Major Aspects'
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
          'steve-jobs': {
            name: 'Steve Jobs',
            placeLabel: 'San Francisco, United States',
            blurb: "Apple co-founder; long-time Zen Buddhist practitioner; 1974 pilgrimage to Neem Karoli Baba's ashram in India"
          },
          'mahatma-gandhi': {
            name: 'Mahatma Gandhi',
            placeLabel: 'Porbandar, India',
            blurb: 'Father of modern India; daily karma-yoga discipline and Bhagavad Gita study'
          },
          'albert-einstein': {
            name: 'Albert Einstein',
            placeLabel: 'Ulm, Germany',
            blurb: 'Theoretical physicist; deep interest in Spinoza, Indian philosophy, and the unity of natural law'
          },
          'paramahansa-yogananda': {
            name: 'Paramahansa Yogananda',
            placeLabel: 'Gorakhpur, India',
            blurb: 'Author of Autobiography of a Yogi; brought Kriya Yoga to the West (1920)'
          },
          'bks-iyengar': {
            name: 'B.K.S. Iyengar',
            placeLabel: 'Bellur, India',
            blurb: 'Founder of Iyengar Yoga; author of Light on Yoga (1966); precision and alignment lineage'
          },
          'sachin-tendulkar': {
            name: 'Sachin Tendulkar',
            placeLabel: 'Mumbai, India',
            blurb: "Cricket legend ('Little Master'); 100 international centuries; Bharat Ratna 2014"
          },
          'narendra-modi': {
            name: 'Narendra Modi',
            placeLabel: 'Vadnagar, India',
            blurb: 'Prime Minister of India since 2014; long-time daily yoga practitioner; founded International Yoga Day (UN, 2014)'
          },
          'dalai-lama-14': {
            name: 'Dalai Lama (14th, Tenzin Gyatso)',
            placeLabel: 'Xining, China',
            blurb: '14th Dalai Lama; spiritual leader of Tibetan Buddhism; Nobel Peace 1989'
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
          aspects: '주요 각도'
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
          'steve-jobs': {
            name: '스티브 잡스',
            placeLabel: '샌프란시스코, 미국',
            blurb: '애플 공동 창업자; 오랜 선불교 수행자; 1974년 인도의 님 카롤리 바바 아쉬람을 순례'
          },
          'mahatma-gandhi': {
            name: '마하트마 간디',
            placeLabel: '포르반다르, 인도',
            blurb: '현대 인도의 아버지; 매일 카르마 요가 수행과 바가바드 기타 공부'
          },
          'albert-einstein': {
            name: '알베르트 아인슈타인',
            placeLabel: '울름, 독일',
            blurb: '이론 물리학자; 스피노자, 인도 철학, 자연 법칙의 통일성에 깊은 관심'
          },
          'paramahansa-yogananda': {
            name: '파라마한사 요가난다',
            placeLabel: '고라크푸르, 인도',
            blurb: '《요가난다, 영혼의 자서전》 저자; 크리야 요가를 서양에 전파(1920)'
          },
          'bks-iyengar': {
            name: 'B.K.S. 아헹가',
            placeLabel: '벨루르, 인도',
            blurb: '아헹가 요가 창시자; 《요가 디피카》(1966) 저자; 정밀성과 정렬 계보'
          },
          'sachin-tendulkar': {
            name: '사친 텐둘카르',
            placeLabel: '뭄바이, 인도',
            blurb: '크리켓 전설(리틀 마스터); 국제 경기 100세기 기록; 2014년 인도 최고 훈장'
          },
          'narendra-modi': {
            name: '나렌드라 모디',
            placeLabel: '바드나가르, 인도',
            blurb: '2014년부터 인도 총리; 오랜 일일 요가 수행자; UN 국제 요가의 날 제안(2014)'
          },
          'dalai-lama-14': {
            name: '달라이 라마 14세 (텐진 갸초)',
            placeLabel: '시닝, 중국',
            blurb: '제14대 달라이 라마; 티베트 불교 영적 지도자; 1989년 노벨 평화상'
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
          aspects: '主要相位'
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
          'steve-jobs': {
            name: '史蒂夫·乔布斯',
            placeLabel: '旧金山, 美国',
            blurb: '苹果联合创始人；长期禅宗修行者；1974 年赴印度尼姆·卡罗利·巴巴道场参学'
          },
          'mahatma-gandhi': {
            name: '圣雄甘地',
            placeLabel: '波尔本德尔, 印度',
            blurb: '现代印度国父；每日实践业瑜伽并研读《薄伽梵歌》'
          },
          'albert-einstein': {
            name: '阿尔伯特·爱因斯坦',
            placeLabel: '乌尔姆, 德国',
            blurb: '理论物理学家；深研斯宾诺莎、印度哲学与自然法则的统一'
          },
          'paramahansa-yogananda': {
            name: '帕拉宏撒·尤迦南达',
            placeLabel: '戈勒克布尔, 印度',
            blurb: '《一个瑜伽行者的自传》作者；1920 年将克利亚瑜伽传入西方'
          },
          'bks-iyengar': {
            name: '艾扬格 (B.K.S. Iyengar)',
            placeLabel: '贝卢尔, 印度',
            blurb: '艾扬格瑜伽创始人；《瑜伽之光》(1966) 作者；以精准与对位著称的瑜伽传承'
          },
          'sachin-tendulkar': {
            name: '萨钦·坦杜尔卡',
            placeLabel: '孟买, 印度',
            blurb: '板球传奇"小大师"；国际赛事百次百分纪录；2014 年获印度最高荣誉国宝勋章'
          },
          'narendra-modi': {
            name: '纳伦德拉·莫迪',
            placeLabel: '瓦德纳加尔, 印度',
            blurb: '自 2014 年起任印度总理；长期每日瑜伽修行者；2014 年倡议联合国国际瑜伽日'
          },
          'dalai-lama-14': {
            name: '第十四世达赖喇嘛 (丹增嘉措)',
            placeLabel: '西宁, 中国',
            blurb: '第十四世达赖喇嘛；藏传佛教精神领袖；1989 年诺贝尔和平奖得主'
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
