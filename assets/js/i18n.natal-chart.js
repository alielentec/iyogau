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
