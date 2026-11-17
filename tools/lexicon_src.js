#!/usr/bin/env node
'use strict';
// Single source of truth for lexicon.json (SPEC 2.4). Regenerate with:  node tools/lexicon_src.js
// It applies the entries below, drops self/duplicate targets and targets that hit no record (dead), then writes lexicon.json.
// G(...) = equivalent members (any expands to all others). O(keys, ...targets) = one-way; FIRST target = preferred official wording.
// Audit rules: an expansion stays only if clinically equivalent or the official/broader wording ICD-10-CM / NHI actually uses;
// never map a term the data already names literally; specific terms never get thousand-record targets.
const groups = [], oneway = {};
const G = (...m) => groups.push(m);
const O = (keys, ...targets) => { for (const k of [].concat(keys)) oneway[k] = (oneway[k] || []).concat(targets.flat()); };

// ------------------------------------------------------------ laterality, direction, qualifiers
G('right', '右'); G('left', '左'); G('bilateral', '雙側'); G('unilateral', '單側');
G('right', '右側'); G('left', '左側');
O('rt', 'right', '右'); O('lt', 'left', '左');
O(['bil', 'bilat'], 'bilateral', '雙側'); O(['uni', 'unilat'], 'unilateral', '單側');
O('ant', 'anterior', '前'); O('post', 'posterior', '後');
O('prox', 'proximal', '近端', 'upper end'); O('dist', 'distal', '遠端', 'lower end');
O('distal', 'lower end'); O('proximal', 'upper end');   // ICD: "Fracture of lower end of radius", "upper end of humerus"
G('proximal', '近端'); G('distal', '遠端'); G('medial', '內側'); G('lateral', '外側');
O('sup', 'superior'); O('infr', 'inferior'); O('med', 'medial'); O('lous', 'lateral');   // legacy v1 keys
O(['unsp', 'unspec'], 'unspecified', '未明示'); G('unspecified', '未明示');
O('dx', 'diagnosis'); O('tx', 'treatment', '治療'); O('hx', 'history');
O(['w', 'wi'], 'with'); O('wo', 'without');
G('initial encounter', '初期照護'); G('subsequent encounter', '後續照護'); G('sequela', '後遺症');
O(['sequelae', 'late effect'], 'sequela', '後遺症');
O('initial', 'initial encounter', '初期照護');
G('multiple', '多處'); G('open', '開放性'); G('closed', '閉鎖性');
G('displaced', '移位'); G('nondisplaced', '非移位'); O(['non displaced', 'undisplaced'], 'nondisplaced', '非移位');
G('comminuted', '粉碎性');
G('upper limb', '上肢'); G('lower limb', '下肢');

// ------------------------------------------------------------ ordinals, degrees, stages (roman numerals only inside these)
O('1st', 'first'); O('2nd', 'second'); O('3rd', 'third'); O('4th', 'fourth'); O('5th', 'fifth');
G('first degree', '一度'); G('second degree', '二度'); G('third degree', '三度'); G('fourth degree', '四度');
O(['1st degree', 'degree 1', 'grade 1 burn', 'superficial burn', '一級燒傷', '第一度'], 'first degree', '一度');
O(['2nd degree', 'degree 2', 'partial thickness burn', 'superficial partial thickness', 'deep partial thickness', '二級燒傷', '第二度', '淺二度', '深二度'], 'second degree', '二度');
O(['3rd degree', 'degree 3', 'full thickness burn', '三級燒傷', '第三度'], 'third degree', '三度');
O(['4th degree', 'degree 4', '四級燒傷', '第四度'], 'fourth degree', '四度');
G('stage 1', '第一期'); G('stage 2', '第二期'); G('stage 3', '第三期'); G('stage 4', '第四期');
O(['stage i', 'stage one', 'grade 1', '1st stage', '一期', '1期'], 'stage 1', '第一期');
O(['stage ii', 'stage two', 'grade 2', '2nd stage', '二期', '2期'], 'stage 2', '第二期');
O(['stage iii', 'stage three', 'grade 3', '3rd stage', '三期', '3期'], 'stage 3', '第三期');
O(['stage iv', 'stage four', 'grade 4', '4th stage', '四期', '4期'], 'stage 4', '第四期');
G('unstageable', '無法分期'); O(['unstaged', 'cannot be staged'], 'unstageable', '無法分期');

// ------------------------------------------------------------ spelling (British -> American as used in ICD/NHI)
O('necrotising', 'necrotizing', '壞死性'); G('necrotizing', '壞死性');
O('oedema', 'edema', '水腫'); G('edema', '水腫'); O('oedematous', 'edema', '水腫');
O('lymphoedema', 'lymphedema', '淋巴水腫'); G('lymphedema', '淋巴水腫');
O('tumour', 'tumor', 'neoplasm', '腫瘤'); O('tumor', 'neoplasm', '腫瘤'); G('neoplasm', '腫瘤');   // 'tumour' has no hit in the data, so tumor->tumour is pruned
O(['haematoma', 'haemotoma'], 'hematoma', '血腫'); G('hematoma', '血腫');
O('haemangioma', 'hemangioma', '血管瘤'); G('hemangioma', '血管瘤');
O(['haemorrhage', 'hemorrage', 'bleeding'], 'hemorrhage', '出血'); G('hemorrhage', '出血');
G('nevus', 'nevi'); O('naevus', 'nevus', 'nevi', '痣'); O(['mole', 'moles', 'melanocytic nevus', 'pigmented nevus', 'pigmented naevus'], 'nevus', 'nevi', '痣', '色素痣');
O(['anaesthesia', 'anaesthetic'], 'anesthesia', '麻醉');
O('oesophagus', 'esophagus', '食道'); O(['paediatric'], 'pediatric', '小兒'); O(['orthopaedic', 'orthopaedics'], 'orthopedic', '骨科');
O('gynaecomastia', 'gynecomastia', 'hypertrophy of breast', '乳房肥大');
O(['ischaemia', 'ischaemic'], 'ischemia', 'ischemic', '缺血'); G('ischemia', '缺血');
O('diarrhoea', 'diarrhea', '腹瀉'); O('foetal', 'fetal', '胎兒'); O('faeces', 'feces');
O('anaemia', 'anemia', '貧血'); G('anemia', '貧血');
O('leukaemia', 'leukemia', '白血病'); O('dyspnoea', 'dyspnea');
O('sulphate', 'sulfate'); O('fibre', 'fiber'); O('litre', 'liter'); O('centre', 'center');
O('hypertrophied', 'hypertrophy', '肥大');
O('mandibular', 'mandible', '下顎'); O('maxillary', 'maxilla', '上顎'); O('zygomatic', 'zygoma', '顴骨');

// ------------------------------------------------------------ fracture / dislocation / trauma
G('fracture', '骨折');
O(['fx', 'fxs', 'fractures', 'fractured', 'broken', 'broken bone'], 'fracture', '骨折');
G('dislocation', '脫位'); O(['dislo', 'dislocated', 'luxation'], 'dislocation', '脫位');
O('subluxation', 'dislocation', 'subluxation', '半脫位');   // ICD index: Subluxation -> see Dislocation
G('sprain', '扭傷'); O('sprained', 'sprain', '扭傷'); O('twisted ankle', 'sprain of ankle');
G('strain', '拉傷');
G('laceration', '撕裂傷');
O(['lac', 'lacs'], 'laceration', '撕裂傷', '裂傷');   // legacy v1: lac -> 裂傷 (NHI "裂傷縫合")
O(['cut', 'cuts', 'lacerated', 'laceration wound', '割傷', '切割傷'], 'laceration', '撕裂傷');
G('open wound', '開放性傷口'); O('wounds', 'wound', '傷口');
O(['avulsed', '撕脫傷'], 'avulsion', '撕脫傷'); G('avulsion', '撕脫傷');
G('contusion', '挫傷'); O(['bruise', 'bruising', 'bruised', '瘀青', '瘀傷'], 'contusion', '挫傷');
G('abrasion', '擦傷'); O(['graze', 'scrape', 'scraped'], 'abrasion', '擦傷');
O(['crush', 'crushed', 'crush injury', 'crushing', 'crushing injury', '擠壓傷', '壓傷', '夾傷', '壓砸傷'], 'crush', '壓砸傷');   // SPEC 8.2
O(['puncture', 'stab', 'stab wound', '刺傷'], 'puncture wound', '刺傷');
G('bite', '咬傷');
O(['bitten', 'dog bite', 'cat bite', 'animal bite', 'human bite', '狗咬', '被狗咬', '貓咬', '人咬', '動物咬傷', '狗咬傷'], 'bite', '咬傷');
G('foreign body', '異物'); O(['fb', 'foreign object', 'retained foreign body'], 'foreign body', '異物');
O(['inj', 'injury', 'trauma', 'traumatic'], 'injury', '損傷', '創傷');
O('inj', 'injection', '注射');   // legacy v1: inj -> injection; injury listed first
G('injury', '損傷');
G('amputation', '截肢'); G('amputation', '切斷'); G('traumatic amputation', '創傷性截斷');
O(['amp', 'amputated', '截斷', '斷肢'], 'amputation', '截肢', '切斷');
O(['斷指', 'severed finger', 'finger cut off', 'digit amputation'], 'traumatic amputation of finger', 'amputation of finger', '手指截肢', '斷指再接');
O(['replant', 'reattachment', 'reattach', '再接', '斷肢再接'], 'replantation', '再接'); G('replantation', '再接');
O(['compartment syndrome', '筋膜室症候群', '腔室症候群', '骨筋膜間隔症候群'], 'compartment syndrome', '腔室症候群', '骨筋膜間隔症候群');
G('fasciotomy', '筋膜切開'); O('faciotomy', 'fasciotomy', '筋膜切開');
O(['vessel injury', 'vascular injury', 'blood vessel injury', '血管損傷'], 'injury of blood vessel');
G('tendon', '肌腱'); G('ligament', '韌帶'); G('nerve', '神經'); G('muscle', '肌肉'); G('bone', '骨'); G('joint', '關節');
G('artery', '動脈'); G('vein', '靜脈'); G('blood vessel', '血管'); G('skin', '皮膚'); G('subcutaneous', '皮下');
G('fascia', '筋膜'); G('lymph', '淋巴'); G('lymph node', '淋巴結');
O(['ln', 'lymph nodes', 'lymphnode', 'lymphnodes', '淋巴腺'], 'lymph node', '淋巴結');
O(['sln', 'slnb', 'sentinel node', 'sentinel lymph node biopsy', '前哨淋巴結切片'], 'sentinel lymph node', '前哨淋巴結');

// ------------------------------------------------------------ burns, cold, wound care, ulcers
G('burn', '燒傷');
O(['burns', 'scald', 'scalds', 'scalding', 'thermal burn', 'flame burn', '燙傷', '灼傷', '火燒傷', '熱燙傷'], 'burn', '燒傷');
O(['chemical burn', 'chemical burns', '化學灼傷', '化學燒傷', '酸燒傷'], 'corrosion', '腐蝕');   // ICD: chemical burn -> Corrosion (T20-T32)
O(['electrical burn', 'electric burn', '電燒傷'], 'burn', '燒傷');
O(['tbsa', 'burn area', '燒傷面積'], 'extent of body surface', '體表面積');
G('frostbite', '凍傷'); O('frost bite', 'frostbite', '凍傷');
G('ulcer', '潰瘍'); O(['sore', 'sores', 'ulceration', 'ulcers'], 'ulcer', '潰瘍');
O(['chronic wound', '慢性傷口'], 'chronic ulcer', '慢性潰瘍');
G('pressure ulcer', '壓迫性潰瘍');
O(['pressure sore', 'pressure sores', 'pressure injury', 'pressure injuries', 'bedsore', 'bedsores', 'bed sore', 'bed sores', 'decubitus', 'decubitus ulcer', 'decubitus ulcers', '褥瘡', '壓瘡', '壓傷', '壓力性損傷', '壓力性潰瘍', '壓瘡性潰瘍', '褥瘡性潰瘍'], 'pressure ulcer', '壓迫性潰瘍');
O(['dfu', 'diabetic ulcer', 'diabetic foot ulcer', 'dm foot', 'diabetic foot', '糖尿病足', '糖尿病足潰瘍', '糖尿病足部潰瘍'], 'diabetes mellitus foot ulcer', 'diabetes mellitus foot', '糖尿病 足部潰瘍');
O('dm ulcer', 'diabetes mellitus ulcer', 'diabetes mellitus skin ulcer');
O(['venous ulcer', 'varicose ulcer', '靜脈性潰瘍', '靜脈曲張潰瘍'], 'varicose veins with ulcer');
O(['stasis ulcer', 'venous stasis ulcer'], 'chronic venous hypertension with ulcer', 'varicose veins with ulcer');
O(['arterial ulcer', 'ischemic ulcer', '動脈性潰瘍', '缺血性潰瘍'], 'atherosclerosis ulceration');
G('gangrene', '壞疽'); O(['gangrenous', 'dry gangrene', 'wet gangrene', '乾性壞疽', '濕性壞疽'], 'gangrene', '壞疽');
G('necrosis', '壞死'); O(['necrotic', '壞死組織'], 'necrosis', '壞死');
O('nf', 'necrotizing fasciitis', '壞死性筋膜炎', 'neurofibromatosis', '神經纖維瘤病');   // NF: necrotizing fasciitis (ward) first, then neurofibromatosis
O(['nec fasc', 'necrotising fasciitis', 'flesh eating', 'flesh-eating', '壞死性筋膜炎'], 'necrotizing fasciitis', '壞死性筋膜炎');
G('neurofibromatosis', '神經纖維瘤病');
G('wound dehiscence', '傷口裂開');
O(['dehiscence', 'wound breakdown', 'wound disruption', '傷口裂開', '傷口哆開', '縫線裂開'], 'disruption of wound', 'dehiscence', '傷口裂開');
O(['wound infection', 'surgical site infection', 'ssi', 'postoperative wound infection', '傷口感染', '術後感染', '手術部位感染'], 'infection following a procedure', 'postprocedural infection', '術後傷口感染', '傷口感染');
G('seroma', '血清腫');
O(['npwt', 'vac', 'vac therapy', 'negative pressure wound therapy', '負壓傷口治療', '負壓傷口'], 'negative pressure wound therapy', '負壓傷口治療');
O(['dressing', 'dressings', 'dressing change', 'wound care', 'wound dressing', '換藥', '傷口護理', '傷口換藥'], 'dressing', 'wound care', '換藥', '傷口處置');
O(['debride', 'debriding', 'debrided', 'debrid'], 'debridement', '清創', '擴創'); G('debridement', '清創'); G('debridement', '擴創');
O(['wound toilet', '清創術', '擴創術', '清創手術'], 'debridement', '清創', '擴創');
O(['suture', 'sutures', 'suturing', 'sutured', 'stitch', 'stitches', 'stiches', 'stitching', '縫合', '縫線'], 'suture', 'stiches', 'stitches', '縫合', '縫線');
O(['remove stitches', 'stitch removal', 'suture removal', 'remove sutures', 'take out stitches', 'removal of stitches', 'sutures out', 'stitches out', '拆縫線'], 'remove stiches', 'remove stitches', '拆線');
G('suture removal', '拆線');
G('surgery', '手術'); G('operation', '手術');
O(['hbo', 'hbot', 'hyperbaric', 'hyperbaric oxygen therapy', '高壓氧治療'], 'hyperbaric oxygen', '高壓氧'); G('hyperbaric oxygen', '高壓氧');
O(['skin biopsy', 'punch biopsy', '皮膚切片', '穿孔切片'], 'skin biopsy', '皮膚切片');
O(['bx', 'biopsies', 'bxs', '活體切片', '組織切片'], 'biopsy', '切片', '組織切片'); G('biopsy', '切片');
O(['exc', 'excis', 'excise', 'excised', '切除術'], 'excision', '切除');
O(['摘除', '摘除術'], 'excision', '摘除');
G('excision', '切除'); G('resection', '切除'); O(['resec', 'resect'], 'resection', '切除');
O(['wle', 'wide local excision', 'wide excision', '廣泛切除', '廣泛性切除', '擴大切除'], 'wide excision', '廣泛切除', '切除');
O(['mohs', 'mohs surgery', '莫氏手術'], 'mohs', '皮膚腫瘤切除術');
O(['rec', 'recon', 'reconstruct', 'reconstructive', '重建術'], 'reconstruction', '重建'); G('reconstruction', '重建');
O(['rep', 'repaired'], 'repair', '修補'); G('repair', '修補');
O(['revise', '修整'], 'revision', '修整');
O(['scar revision', '疤痕修整', '疤痕整形'], 'scar', '疤痕', '瘢痕');
O(['grft', 'grafting'], 'graft', '移植'); G('graft', '移植');
O(['release', 'releasing', '鬆解', '鬆解術'], 'release', '鬆解');
O(['inf', 'infect', 'infected'], 'infection', '感染'); G('infection', '感染');
O(['abd', 'abdominal'], 'abdomen', 'abdominal', '腹');
O(['thx', 'thoracic'], 'thorax', 'thoracic', '胸');

// ------------------------------------------------------------ skin, soft tissue, scars
G('hypertrophic scar', '肥厚性疤痕');
O(['keloid', 'keloids', 'cheloid', 'keloid scar', 'hts', 'hypertrophic scars', 'raised scar', '蟹足腫', '疤痕增生', '增生性疤痕', '肥厚疤痕', '蟹足腫疤痕'], 'hypertrophic scar', '肥厚性疤痕');
G('scar', '疤痕'); O(['scars', 'scarring', 'cicatrix', '傷疤', '瘢痕', '疤痕組織'], 'scar', '疤痕');
G('contracture', '攣縮'); O(['contractures', '攣縮症'], 'contracture', '攣縮');
O(['scar contracture', '疤痕攣縮', '攣縮疤痕'], 'scar conditions and fibrosis of skin', 'scar');
G('cellulitis', '蜂窩組織炎');
O(['cellulitic', 'cellulites', '蜂窩性組織炎', '蜂窩織炎', '蜂窩組織發炎', '蜂窩性織炎'], 'cellulitis', '蜂窩組織炎');
O(['paronychia', 'whitlow', '甲周炎', '指甲周圍炎', '甲溝炎'], 'cellulitis of finger', 'cellulitis of toe', 'paronychia');   // ICD index: Paronychia -> see Cellulitis, digit
O(['felon', 'pulp infection', '指頭炎', '指腹感染', '化膿性指頭炎'], 'cellulitis of finger', 'abscess of finger', '指蜂窩組織炎', '指膿瘍', 'felon');
G('abscess', '膿瘍'); O(['abscesses', '膿包', '膿腫'], 'abscess', '膿瘍');
O(['boil', 'boils', 'furuncle'], 'furuncle', 'abscess', '癤');
O(['i&d', 'incision and drainage', 'incision drainage', 'i and d', '切開引流', '切開排膿'], 'incision and drainage', '切開排膿', '切開引流');
G('cyst', '囊腫'); O('cysts', 'cyst', '囊腫');
O(['sebaceous cyst', 'sebaceous cysts', 'epidermoid cyst', 'epidermal cyst', 'inclusion cyst', 'atheroma', 'wen', '粉瘤', '皮脂腺囊腫', '皮脂囊腫', '表皮囊腫'], 'epidermal cyst', 'sebaceous cyst', '皮脂腺囊腫', '表皮囊腫');
O(['pilar cyst', 'trichilemmal cyst', 'follicular cyst', '毛囊囊腫'], 'pilar cyst', 'trichilemmal cyst', 'follicular cyst');
O(['ganglion cyst', 'wrist ganglion', 'wrist cyst', 'bible cyst', '腱鞘囊腫', '腕部囊腫', '手腕囊腫', '腱鞘囊'], 'ganglion', '腱鞘囊腫');
G('lipoma', '脂肪瘤'); G('lipoma', 'benign lipomatous neoplasm');
O(['lipoma', 'lipomas', 'fatty lump', 'fatty tumor', 'fat lump', '脂肪瘤', '皮下脂肪瘤'], 'benign lipomatous neoplasm', 'subcutaneous tumor', '脂肪瘤', '皮下腫瘤');   // SPEC 2.4
O(['mass', 'masses', 'lump', 'lumps', '腫塊', '硬塊', '小腫塊'], 'localized swelling mass lump', '腫塊');   // ICD index: Mass -> Localized swelling, mass and lump (R22)
O(['wart', 'warts', 'verruca', 'verruca vulgaris', '病毒疣', '尋常疣'], 'viral warts', 'wart', '疣');
O(['skin tag', 'skin tags', 'acrochordon', '皮贅', '軟纖維瘤'], 'skin tag', 'acrochordon', '皮贅');
O(['seborrheic keratosis', 'seborrhoeic keratosis', '脂漏性角化', '老人斑', '脂漏性角化症'], 'seborrheic keratosis', '脂漏性角化');
O(['actinic keratosis', 'solar keratosis', '光化性角化', '日光性角化'], 'actinic keratosis', '光化性角化');
O(['corn', 'corns', 'callus', 'calluses', '雞眼', '胼胝', '厚繭'], 'corns and callosities', '雞眼', '胼胝');
O(['ingrown toenail', 'ingrown nail', 'ingrowing toenail', '嵌甲', '趾甲內生'], 'ingrowing nail', '甲內生');
G('nail', '指甲'); O(['nails', 'fingernail', 'fingernails'], 'nail', '指甲');
O(['alopecia', 'hair loss', 'baldness', '掉髮', '禿髮', '脫髮', '落髮'], 'alopecia', '禿髮');
O(['hyperhidrosis', 'excessive sweating', 'palmar hyperhidrosis', '多汗', '多汗症', '手汗'], 'hyperhidrosis', '多汗症');
O(['hidradenitis', 'acne inversa', '化膿性汗腺炎'], 'hidradenitis suppurativa', '化膿性汗腺炎');
O(['pilonidal', 'pilonidal sinus', '藏毛囊腫', '藏毛竇', '藏毛症'], 'pilonidal cyst', '藏毛囊腫');
O(['vitiligo', '白癜風'], 'vitiligo', '白斑');
O(['port wine stain', 'port-wine stain', 'portwine', 'capillary malformation', '葡萄酒斑'], 'nevus flammeus', 'port wine', '先天性血管畸形');
O(['strawberry hemangioma', 'strawberry mark', 'infantile hemangioma', '草莓狀血管瘤', '嬰兒血管瘤'], 'hemangioma', '血管瘤');
O(['vascular malformation', 'avm', 'arteriovenous malformation', '血管畸形', '動靜脈畸形'], 'arteriovenous malformation', 'vascular malformation', '動靜脈畸形', '血管畸形');
O(['lymphatic malformation', 'cystic hygroma', '淋巴管畸形', '淋巴管瘤', '囊狀水瘤'], 'lymphangioma', 'lymphatic malformation', '淋巴管瘤', '囊狀水瘤');
O(['histiocytoma', 'dermatofibroma', '皮膚纖維瘤'], 'dermatofibroma', 'fibroma', '纖維瘤');
O(['pyogenic granuloma', 'lobular capillary hemangioma', '化膿性肉芽腫'], 'pyogenic granuloma', '化膿性肉芽腫');
O(['laser', 'laser treatment', 'co2 laser', 'argon laser', 'erbium laser', 'yag laser', '雷射', '雷射治療', '雷射手術', '二氧化碳雷射', '氬氣雷射', '鉺雅鉻雷射'], 'laser', '雷射');
O(['botox', 'botulinum', 'botulinum toxin', '肉毒桿菌', '肉毒', '肉毒桿菌素'], 'botulinum toxin', '肉毒桿菌');
O(['filler', 'fillers', 'hyaluronic acid', '玻尿酸', '填充劑'], 'filler', '填充');
O(['injection', 'injections', 'inject', '注射', '打針'], 'injection', '注射');
O(['steroid injection', 'steroid inj', 'cortisone injection', 'intralesional steroid', 'kenalog', '類固醇注射', '病灶內注射', '疤痕注射'], 'steroid injection', '類固醇注射');
O(['lipo', 'liposuction', 'suction lipectomy', 'fat suction', '抽脂', '脂肪抽吸', '抽脂術'], 'liposuction', 'suction lipectomy', '抽脂', '脂肪抽吸');
O(['fat graft', 'fat grafting', 'lipofilling', 'lipoinjection', 'fat transfer', '脂肪移植', '自體脂肪移植', '脂肪填充'], 'fat graft', 'fat transplantation', '脂肪移植');

// ------------------------------------------------------------ skin grafts and flaps (NHI wording)
G('skin graft', '植皮'); G('skin graft', '皮膚移植'); G('skin graft', '植補');
O(['stsg', 'ssg', 's.t.s.g', 'split thickness', 'split thickness skin graft', 'split skin graft', 'split-thickness', 'partial thickness graft', 'sheet graft', 'meshed graft', 'meshed skin graft', '中厚皮', '中厚植皮', '網狀植皮', '多層植皮', '多層皮膚移植', '刃厚皮膚移植', '薄層植皮'], 'split thickness skin graft', '多層皮膚移植');
O('sts', 'malignant neoplasm of connective and soft tissue', '結締組織及軟組織惡性腫瘤', 'split thickness skin graft', '多層皮膚移植');   // STS: soft tissue sarcoma first, then STSG
O(['ftsg', 'f.t.s.g', 'full thickness skin graft', 'full thickness graft', 'wolfe graft', '全層皮膚移植', '全層植皮', '全層皮', '皮膚全層植皮'], 'full thickness skin graft', '皮膚全層植補術', '全層植補');
O(['dermal graft', 'dermal substitute', 'integra', 'artificial skin', 'skin substitute', '人工皮', '人工真皮', '皮膚替代物'], 'artificial skin', '人工皮');
O(['alt', 'alt flap', 'anterolateral thigh flap', 'alt perforator', '股前外側皮瓣', '前外側大腿皮瓣'], 'perforator flap', 'free flap', '穿通枝瓣', '游離皮瓣');
O(['diep', 'diep flap', 'siea', 'tdap', 'sgap', 'igap', 'pap', 'perforator', 'perforators', '穿通枝皮瓣', '穿通皮瓣', '穿支皮瓣'], 'perforator flap', '穿通枝瓣');
O(['tram', 'tram flap', 'ptram', 'mstram', 'transverse rectus abdominis', '腹直肌皮瓣', '橫向腹直肌皮瓣'], 'myocutaneous flap', '肌皮瓣');
O(['ld', 'ld flap', 'latissimus dorsi flap', 'lat dorsi flap', '背闊肌皮瓣', '闊背肌皮瓣', '背闊肌瓣'], 'myocutaneous flap', 'muscle flap', 'free flap', '肌皮瓣', '肌肉瓣', '游離皮瓣');
O(['rfff', 'radial forearm flap', 'radial forearm free flap', 'chinese flap', 'rf flap', '橈側前臂皮瓣', '前臂游離皮瓣', '橈側前臂游離皮瓣'], 'free flap', 'microvascular free flap', '游離皮瓣', '顯微血管游離瓣');
O(['pmmc', 'pmmc flap', 'pectoralis major flap', 'pectoralis flap', '胸大肌皮瓣'], 'pectoralis major myocutaneous flap', '大胸肌皮瓣', 'myocutaneous flap', '肌皮瓣');
O(['gracilis flap', '股薄肌皮瓣'], 'muscle flap', 'free flap', '肌肉瓣', '游離皮瓣');
O(['fibula flap', 'free fibula', 'fibular flap', 'ffff', 'vascularized fibula', '游離腓骨', '腓骨皮瓣', '腓骨游離皮瓣', '腓骨瓣'], 'free flap', 'microvascular free flap', '游離皮瓣');
O(['free flap', 'free tissue transfer', 'microsurgical flap', 'microvascular flap', 'free flaps', 'free tissue', '游離皮瓣', '游離瓣', '游離組織', '游離組織移植', '顯微皮瓣', '顯微重建', '顯微手術皮瓣'], 'microvascular free flap', 'free flap', '顯微血管游離瓣', '游離瓣');
O(['pedicled flap', 'pedicle flap', 'regional flap', 'island flap', '帶蒂皮瓣', '有蒂皮瓣', '島狀皮瓣'], 'pedicle flap', '根蒂皮瓣', '島狀根帶蒂皮瓣');
O(['local flap', 'local flaps', 'transposition flap', 'rhomboid flap', 'limberg flap', 'bilobed flap', 'keystone flap', 'keystone', '局部皮瓣', '轉位皮瓣', '菱形皮瓣'], 'local flap', '局部皮瓣');
O(['advancement flap', 'advance flap', '推進皮瓣', '移前皮瓣'], 'advance flap', '移前皮瓣');
O(['rotation flap', '旋轉皮瓣'], 'rotation flap', '旋轉皮瓣');
O(['z plasty', 'zplasty', 'z-plasty', 'z形皮瓣', 'z型皮瓣', 'z成形', 'z形成形術'], 'z-plasty', 'z plasty', 'z形皮瓣', 'Ｚ－形皮瓣');
O(['v-y', 'vy', 'v y', 'v-y plasty', 'v-y advancement', '手部v-y'], 'v-y plasty', 'v-y advancement flap', 'v-y 形皮瓣', '手部v-y型皮瓣手術');
O(['tissue expander', 'expander', 'tissue expansion', '組織擴張器', '擴張器', '組織擴張', '擴張術'], 'tissue expander', '組織擴張器');
G('flap', '皮瓣'); O(['flaps', 'skin flap', '皮瓣手術', '皮瓣移植', '轉移皮瓣'], 'flap', '皮瓣');
O(['cross finger flap', 'cross-finger flap', 'crossfinger', 'cross finger', '交指皮瓣'], 'cross finger skin flap', '交指皮瓣');
O(['cross leg flap', 'cross-leg flap', 'cross leg', '交腳皮瓣', '交腿皮瓣'], 'cross leg skin flap', '交腳皮瓣');
O(['groin flap', '腹股溝皮瓣', '鼠蹊皮瓣'], 'groin flap', '腹股溝皮瓣');
O(['tube pedicle', 'tube flap', 'tubed pedicle', '管形皮瓣', '管型皮瓣'], 'tube pedicle', '管形皮膚移植術');
O(['composite graft', '複合移植'], 'composite graft', '複合移植');
O(['oral mucosal flap', 'mucosal flap', '口腔粘膜皮瓣'], 'oral mucous flap', '口腔粘膜皮瓣');
O(['tongue flap', '舌瓣'], 'tongue flap', '舌瓣');
O(['lip flap', 'abbe flap', 'abbe', '唇部皮瓣', '唇皮瓣'], 'lip flap', '唇部皮瓣');
O(['nerve graft', 'sural nerve graft', '神經移植'], 'nerve graft', 'nerve repair', '神經移植', '神經修補');
O(['nerve repair', 'neurorrhaphy', 'nerve suture', 'nerve coaptation', 'primary nerve repair', 'neuroplasty', '神經縫合', '神經吻合', '神經縫合術', '神經接合', '神經修補'], 'nerve repair', '神經修補', '神經縫合');
O(['tendon repair', 'tenorrhaphy', 'tendon suture', 'flexor tendon repair', 'extensor tendon repair', 'tendon sutured', '肌腱縫合', '肌腱縫合術', '肌腱修復', '肌腱吻合', '屈肌腱修補', '伸肌腱修補'], 'tendon repair', '肌腱修補');
O(['tendon graft', 'tendon transfer', '肌腱移植', '肌腱移位'], 'tendon graft', '肌腱移植');
O(['microsurgery', 'microvascular', 'anastomosis', 'vessel anastomosis', 'vascular anastomosis', '顯微手術', '顯微外科', '血管吻合', '血管接合'], 'microvascular', '顯微血管');
O(['vascular repair', 'arterial repair', 'vein graft', 'artery repair', 'arteriorrhaphy', '血管修補', '血管移植', '動脈修補', '靜脈移植'], 'vascular repair', 'repair of blood vessel', '血管修補');
O(['bone graft', 'bone grafting', 'iliac crest graft', 'cancellous graft', '骨移植', '植骨', '植骨術', '骨頭移植'], 'bone graft', '骨移植');
O(['cartilage graft', 'rib cartilage', 'costal cartilage', 'ear cartilage', '軟骨移植', '肋軟骨', '耳軟骨'], 'cartilage graft', '軟骨移植', '骨或軟骨移植術');
O(['implant', 'implants', 'prosthesis', 'prosthetic', '植入物', '義肢', '假體', '人工植入物', '人工植體'], 'implant', 'prosthesis', '植入', '義肢');
O(['hardware removal', 'removal of hardware', 'implant removal', 'plate removal', 'remove plate', 'remove screw', 'screw removal', 'k wire removal', 'pin removal', '取出內固定', '鋼板取出', '內固定物取出', '拆除鋼釘', '取鋼釘', '取鋼板'], 'removal of internal fixation', 'removal of implant', '內固定物取出', '取出');
O(['wire fixation', 'k wire', 'k-wire', 'kwire', 'pinning', 'percutaneous pinning', 'k-wire fixation', '鋼釘固定', '克氏針', '克氏鋼針', '經皮鋼釘'], 'wire fixation', 'fixation', '固定');
O(['orif', 'open reduction', 'open reduction internal fixation', 'open reduction and internal fixation', 'internal fixation', 'plating', 'plate fixation', 'plate and screw', '開放性復位', '開放復位', '內固定', '鋼板固定', '鋼板內固定', '開放性復位內固定術'], 'open reduction', 'open reduction internal fixation', '開放性復位', '開放復位', '內固定');
O(['crpp', 'closed reduction', 'closed reduction percutaneous pinning', 'manipulation', 'reduction', '閉鎖性復位', '閉合性復位', '徒手復位', '復位', '閉鎖復位'], 'closed reduction', 'reduction', '閉鎖性復位', '閉鎖復位', '復位');
O(['cast', 'casting', 'plaster', 'plaster cast', 'splint', 'splinting', 'cast application', 'fiberglass cast', '石膏', '石膏固定', '打石膏', '副木', '夾板'], 'cast', 'splint', 'plaster', '石膏', '石膏固定', '副木');
O(['sac', 'short arm cast', 'short arm', '短臂石膏', '短手臂石膏'], 'cast short arm', 'p.p cast short arm', '石膏固定 短臂');
O(['long arm cast', 'long arm', '長臂石膏', '長手臂石膏'], 'cast long arm', '石膏固定 長臂');
O(['dermabrasion', 'microdermabrasion', 'sanding', '磨皮', '微晶磨皮', '磨皮術', '皮膚磨皮'], 'dermabrasion', '磨皮術');
O(['skoog', 'sweat gland excision', 'axillary sweat gland', '腋下汗腺', '汗腺切除', '腋下汗腺切除', '汗腺切除術'], 'skoog operation', '腋下汗腺切除術');
O(['osmidrosis', 'axillary osmidrosis', 'body odor', 'underarm odor', '腋臭', '狐臭'], 'bromhidrosis', 'osmidrosis', '腋臭');
G('sweat gland', '汗腺');
O(['hydrosurgery', 'versajet', 'water jet', 'waterjet', '水刀', '水刀清創'], 'hydrosurgery', '水刀清創');
O(['muscle biopsy', '肌肉切片'], 'muscle biopsy', '肌肉切片');
O(['skin cancer excision', 'excision of skin cancer', 'skin cancer surgery', '皮膚惡性腫瘤切除', '皮膚癌切除', '皮膚癌手術'], 'excision of skin cancer', '皮膚惡性腫瘤切除');
O(['tumor biopsy', 'tumour biopsy', 'incisional biopsy', 'excisional biopsy', '腫瘤切片', '腫瘤組織檢查'], 'tumor biopsy', '腫瘤組織檢查切片術');

// ------------------------------------------------------------ hand surgery and orthopaedic/plastic conditions
O(['cts', 'carpal tunnel', 'median nerve entrapment', '腕隧道', '腕隧道症候群', '腕道症候群', '腕管', '腕管症候群'], 'carpal tunnel syndrome', '腕隧道症候群', '腕道症候群');
O(['ctr', 'carpal tunnel release', 'carpal tunnel decompression', 'ectr', 'endoscopic carpal tunnel release', 'open carpal tunnel release', '腕隧道減壓', '腕道減壓', '腕隧道鬆解', '腕管減壓', '腕管鬆解', '腕隧道手術'], 'carpal tunnel release', '腕道減壓');
O(['cubital tunnel', 'cubital tunnel syndrome', 'ulnar nerve compression', 'ulnar nerve entrapment', '肘隧道', '肘管症候群'], 'lesion of ulnar nerve', 'ulnar nerve lesion');
G('trigger finger', '扳機指');
O(['trigger thumb', 'trigger digit', 'a1 pulley release', '板機指', '彈響指', '彈跳指', '板機指手術', '扳機指手術'], 'trigger finger', '扳機指', '板機指');
O(['de quervain', 'dequervain', 'de quervain tenosynovitis', "de quervain's", 'quervain', 'first dorsal compartment', 'mother hand', 'mommy thumb', '媽媽手', '狹窄性腱鞘炎', '橈骨莖突腱鞘炎', '德奎凡'], 'radial styloid tenosynovitis', '橈骨莖狀突腱鞘炎', '橈骨莖突狹窄性腱鞘炎');
O(['dupuytren', "dupuytren's", 'dupuytren contracture', 'palmar fibromatosis', 'palmar fasciectomy', '掌腱膜攣縮', '杜普宜特朗', '掌筋膜攣縮', '掌腱膜纖維瘤', '掌筋膜纖維瘤'], 'dupuytren contracture', 'palmar fascial fibromatosis', '掌筋膜纖維瘤症');
O(['mallet', 'mallet finger', 'baseball finger', 'drop finger', '槌狀指', '鎚狀指', '垂狀指'], 'mallet finger', '鎚狀指', '槌狀指');
O(['boutonniere', 'swan neck', 'swan neck deformity', '鈕釦孔變形', '天鵝頸變形', '鈕扣畸形'], 'boutonniere deformity', 'swan-neck deformity', '鈕釦孔變形', '天鵝頸變形');
O(['boxer fracture', "boxer's fracture", '拳擊手骨折'], 'fracture of metacarpal bone', '掌骨骨折');
O(['metacarpal fracture', '掌骨骨折', '第五掌骨骨折'], 'fracture of metacarpal bone', '掌骨骨折');
G('scaphoid', 'navicular'); G('scaphoid', '舟狀骨'); O(['carpal scaphoid', '腕舟骨', '手舟骨', '舟骨'], 'scaphoid', 'navicular', '舟狀骨');
O(['distal radius fracture', 'colles', "colles' fracture", 'colles fracture', 'smith fracture', '橈骨遠端骨折', '科力氏骨折', '橈骨下端骨折'], 'fracture of lower end of radius', '橈骨遠端');
O('distal radius', 'lower end of radius', '橈骨遠端');
G('radius', '橈骨'); G('ulna', '尺骨'); G('humerus', '肱骨'); G('femur', '股骨'); G('tibia', '脛骨'); G('fibula', '腓骨'); G('clavicle', '鎖骨'); G('scapula', '肩胛骨'); G('metacarpal', '掌骨'); G('metatarsal', '蹠骨'); G('carpal', '腕骨'); G('tarsal', '跗骨');
O(['collar bone', 'collarbone'], 'clavicle', '鎖骨');
O(['shin bone', 'shinbone'], 'tibia', '脛骨');
O(['thigh bone', 'thighbone'], 'femur', '股骨');
O('upper arm bone', 'humerus', '肱骨');
O(['kneecap', 'knee cap', 'patella', '髕骨', '膝蓋骨'], 'patella', '髕骨');
O(['heel bone', 'calcaneal', '跟骨'], 'calcaneus', '跟骨');
O(['tailbone', 'tail bone', '尾椎', '尾骨'], 'coccyx', '尾骨');
O(['hip fracture', '髖部骨折', '股骨頸骨折'], 'fracture of neck of femur', '股骨頸');
O(['om', 'bone infection', '骨感染', '骨頭感染', '慢性骨髓炎', '急性骨髓炎'], 'osteomyelitis', '骨髓炎'); G('osteomyelitis', '骨髓炎');
O(['sequestrectomy', 'saucerization', 'sequestrum', '死骨切除', '蝶形手術', '死骨'], 'sequestrectomy', 'saucerization', '死骨切除術');
O(['septic arthritis', 'joint infection', '化膿性關節炎', '關節感染'], 'pyogenic arthritis', 'septic arthritis', '化膿性關節炎');
O(['oa', 'degenerative joint disease', '退化性關節炎', '骨關節炎'], 'osteoarthritis', '骨關節炎');
O(['non-union', 'non union', '不癒合', '骨不癒合', '骨折不癒合'], 'nonunion', '不癒合');
O(['webbed fingers', 'fused fingers', 'webbed finger', '併指', '併指症', '蹼指'], 'syndactyly', '併指'); G('syndactyly', '併指');
O(['extra finger', 'supernumerary finger', 'supernumerary digit', '多指', '多指症', '多指畸形', '六指'], 'polydactyly', '多指'); G('polydactyly', '多指');
O(['thumb duplication', 'duplicate thumb', 'extra thumb', 'accessory thumb', '重複拇指'], 'polydactyly', 'accessory thumb', '多指');
O(['macrodactyly', 'giant finger', '巨指症', '巨指'], 'macrodactyly', '巨指');
O(['cleft hand', 'split hand', 'ectrodactyly', '裂手', '裂手畸形'], 'cleft hand', 'split hand', '裂手');
O(['clubfoot', 'club foot', 'talipes', '內翻足', '馬蹄內翻足'], 'talipes', 'clubfoot', '馬蹄內翻足');
O(['hallux valgus', '拇趾外翻', '拇外翻'], 'hallux valgus', '拇趾外翻');
O(['hammer toe', 'hammertoe', '槌狀趾', '鎚狀趾'], 'hammer toe', '鎚狀趾');
O(['plantar fasciitis', '足底筋膜炎'], 'plantar fascial fibromatosis', 'plantar fasciitis', '蹠筋膜纖維瘤症');
O(['heel spur', '足跟骨刺', '跟骨骨刺'], 'calcaneal spur', '跟骨骨刺');
O(['tennis elbow', 'lateral epicondylitis', '網球肘', '肱骨外上髁炎'], 'lateral epicondylitis', '外側肱上髁炎');
O(['golfer elbow', "golfer's elbow", 'medial epicondylitis', '高爾夫球肘'], 'medial epicondylitis', '內側肱上髁炎');
O(['rc tear', 'shoulder tear', '旋轉袖', '旋轉肌袖撕裂', '肩旋轉肌'], 'rotator cuff', '旋轉肌袖', '肩袖');
O(['frozen shoulder', 'adhesive capsulitis', '五十肩', '冰凍肩', '沾黏性肩關節囊炎'], 'adhesive capsulitis of shoulder', '粘連性囊炎');
O(['bursitis', '滑囊炎', '滑液囊炎'], 'bursitis', '滑囊炎');
O(['acl', 'anterior cruciate', '前十字韌帶'], 'anterior cruciate ligament', 'cruciate ligament', '十字韌帶');
O(['meniscal tear', 'meniscus tear', '半月板撕裂'], 'tear of meniscus', 'meniscus', '半月板');
O(['achilles', '跟腱', '阿基里斯腱'], 'achilles tendon', '阿基里斯腱');
O(['paralysis', '癱瘓'], 'palsy', '麻痺', '癱瘓'); O('palsy', 'paralysis', '麻痺');
O(['bpi', '臂叢神經損傷', '臂神經叢損傷', '臂叢'], 'injury of brachial plexus', 'brachial plexus', '臂神經叢');
O(['facial palsy', 'facial paralysis', 'facial nerve palsy', "bell's palsy", 'bells palsy', '顏面神經麻痺', '顏面麻痺', '貝爾氏麻痺', '面癱', '面神經麻痺', '貝爾麻痺'], 'bell palsy', 'facial nerve disorders', '貝爾氏麻痺');
O(['peripheral nerve injury', 'nerve damage', '神經受損', '周邊神經損傷'], 'nerve injury', '神經損傷');
O(['amputation neuroma', 'painful neuroma', '截肢神經瘤', '神經瘤'], 'neuroma', '神經瘤');
O(['complex regional pain syndrome', 'crps', 'rsd', 'reflex sympathetic dystrophy', '複雜性局部疼痛症候群', '反射性交感神經失養症', '交感神經失養'], 'complex regional pain syndrome', 'reflex sympathetic dystrophy', '複雜性局部疼痛症候群');
O(['raynaud', "raynaud's", 'raynaud phenomenon', '雷諾氏症', '雷諾現象', '雷諾氏現象', '雷諾症'], 'raynaud syndrome', '雷諾');
O(['lymph edema', 'elephantiasis', '淋巴腫', '象皮病'], 'lymphedema', '淋巴水腫');
O(['lvb', 'lva', 'lymphovenous', 'lymphaticovenous', 'lymphovenous bypass', 'lymphovenous anastomosis', '淋巴靜脈吻合', '淋巴靜脈接合'], 'lymphovenous anastomosis', '淋巴靜脈吻合');
O(['paod', 'pad', 'peripheral artery disease', 'peripheral arterial disease', 'peripheral arterial occlusive disease', 'pvd', 'peripheral vascular disease', 'arteriosclerosis obliterans', 'aso', '周邊動脈阻塞', '周邊動脈疾病', '周邊血管疾病', '動脈硬化阻塞'], 'peripheral vascular disease', 'atherosclerosis of native arteries of extremities', '周邊血管疾病');
O(['claudication', '間歇性跛行'], 'intermittent claudication');
O(['dvt', 'deep vein thrombosis', 'venous thrombosis', '深部靜脈血栓', '靜脈血栓', '深層靜脈栓塞', '靜脈栓塞'], 'embolism and thrombosis of veins', 'venous thrombosis', '靜脈栓塞', '靜脈血栓');
O(['varicose', 'varicosity', 'varicosities', '靜脈曲張', '下肢靜脈曲張'], 'varicose veins', '靜脈曲張');
O('dm', 'type 2 diabetes mellitus', 'diabetes mellitus', '糖尿病');
O(['diabetes', 'diabetic', 'dm2', 't2dm', 'niddm', 'type 2 dm', '糖尿病', '第二型糖尿病', '第2型糖尿病', '二型糖尿病', '糖尿'], 'diabetes mellitus', '糖尿病');
O(['t1dm', 'iddm', 'type 1 dm', 'type 1 diabetes', 'juvenile diabetes', '第一型糖尿病', '第1型糖尿病', '一型糖尿病'], 'type 1 diabetes mellitus', '第一型糖尿病');
G('diabetes mellitus', '糖尿病');
O('htn', 'essential hypertension', '本態性高血壓');   // default meaning only; a generic 'hypertension' target would outrank I10 (verified)
O(['high blood pressure', 'hbp', '高血壓', '血壓高'], 'hypertension', '高血壓');   // ICD I10 "Essential (primary) hypertension"
O(['cad', 'coronary artery disease', 'ischemic heart disease', 'ihd', '冠狀動脈疾病', '冠心病', '缺血性心臟病'], 'atherosclerotic heart disease', 'coronary artery disease', 'ischemic heart disease', '冠狀動脈', '缺血性心臟病');
O(['mi', 'heart attack', 'ami', 'stemi', 'nstemi', '心肌梗塞', '心肌梗死'], 'myocardial infarction', '心肌梗塞', '心肌梗死');
O(['chf', 'congestive heart failure', 'cardiac failure', '心衰竭', '心臟衰竭', '鬱血性心衰竭'], 'heart failure', '心臟衰竭', '心衰竭');
O(['afib', 'a fib', 'atrial fibrillation', '心房顫動', '心房纖維顫動', '心房震顫'], 'atrial fibrillation', '心房顫動');
O(['cva', 'stroke', 'cerebrovascular accident', 'brain infarct', '中風', '腦中風', '腦梗塞', '腦梗死', '腦血管意外'], 'cerebral infarction', 'stroke', '腦梗塞', '腦中風');
O(['洗腎', 'renal dialysis', 'kidney dialysis'], 'dialysis', '透析', '血液透析');   // lay 洗腎 = dialysis wording, not CKD
O(['ckd', '慢性腎臟病'], 'chronic kidney disease', '慢性腎臟病');
O(['esrd', 'ckd5', '末期腎臟病'], 'end stage renal disease', 'chronic kidney disease stage 5', '末期腎臟病');
O(['renal insufficiency', 'kidney failure', 'renal failure', 'uremia', '腎衰竭', '腎功能不全', '尿毒症'], 'renal failure', '腎衰竭');
O(['copd', 'chronic obstructive', '慢性阻塞性肺病', '慢性阻塞性肺疾病'], 'chronic obstructive pulmonary disease', '慢性阻塞性肺病');
O(['uti', '泌尿道感染', '尿道感染'], 'urinary tract infection', '泌尿道感染');
O(['obesity', 'obese', '肥胖'], 'obesity', '肥胖');
O(['morbid obesity', '病態性肥胖'], 'morbid obesity', '病態性肥胖');
O(['sepsis', 'septic', 'septicemia', '敗血症', '敗血性'], 'sepsis', '敗血症');
O(['mrsa', '抗藥性金黃色葡萄球菌'], 'methicillin resistant staphylococcus aureus', 'staphylococcus', '葡萄球菌');
O(['staph', 'staph aureus', 'staphylococcus', '金黃色葡萄球菌'], 'staphylococcus', '葡萄球菌');
G('pseudomonas', '綠膿桿菌'); O('pseudomonas aeruginosa', 'pseudomonas', '綠膿桿菌');
O(['tetanus', 'lockjaw', '破傷風'], 'tetanus', '破傷風');
O(['allergy', 'allergic', 'allergic reaction', '過敏', '過敏反應'], 'allergy', 'allergic', '過敏');
O(['hives', 'urticaria', '蕁麻疹'], 'urticaria', '蕁麻疹');
G('pain', '疼痛'); O('ache', 'pain', '疼痛');

// ------------------------------------------------------------ oncology: skin, head and neck, breast
O(['bcc', 'basal cell', 'basal cell ca', 'basal cell cancer', 'rodent ulcer', '基底細胞癌', '基底細胞'], 'basal cell carcinoma', '基底細胞癌');
O(['scc', 'squamous cell', 'squamous cell ca', 'squamous cell cancer', 'epidermoid carcinoma', '鱗狀細胞癌', '鱗狀上皮癌', '鱗狀上皮細胞癌', '鱗狀細胞'], 'squamous cell carcinoma', '鱗狀細胞癌');
O(['mm', 'malignant melanoma', 'melanoma', 'melanomas', 'skin melanoma', '黑色素瘤', '惡性黑色素瘤', '黑色素癌'], 'melanoma', '黑色素瘤');
O('lentigo maligna', 'melanoma in situ', 'melanoma');
O(['skin cancer', 'skin ca', 'cutaneous carcinoma', 'skin malignancy', '皮膚癌', '皮膚惡性腫瘤'], 'malignant neoplasm of skin', '皮膚惡性腫瘤');
O(['merkel', 'merkel cell', 'merkel cell carcinoma', 'mcc', '梅克爾細胞癌', '默克細胞癌', 'merkel細胞癌'], 'merkel cell carcinoma', '梅克爾細胞癌');
O(['sarcoma', 'sarcomas', 'soft tissue sarcoma', 'liposarcoma', 'leiomyosarcoma', 'rhabdomyosarcoma', 'angiosarcoma', '肉瘤', '軟組織肉瘤', '脂肪肉瘤', '平滑肌肉瘤', '橫紋肌肉瘤', '血管肉瘤'], 'malignant neoplasm of connective and soft tissue', '結締組織及軟組織惡性腫瘤');
O('ca', 'malignant neoplasm', 'cancer', 'carcinoma', '惡性腫瘤', '癌');   // legacy v1: ca -> cancer, carcinoma, 癌
O(['cancer', 'malignancy', 'malignant', 'malignant tumor', 'malignant tumour', 'cancerous', '癌症', '惡性', '癌病'], 'malignant neoplasm', '惡性腫瘤', 'cancer', '癌');
G('cancer', 'malignant neoplasm'); G('cancer', '惡性腫瘤'); G('carcinoma', 'malignant neoplasm'); G('carcinoma', '癌'); G('carcinoma', '惡性腫瘤');
O('carcinomas', 'carcinoma', '癌');
G('benign', '良性'); O(['non cancerous', 'noncancerous'], 'benign', '良性');
G('in situ', '原位'); G('carcinoma in situ', '原位癌'); O(['原位癌'], 'carcinoma in situ', 'in situ');
O(['bowen', "bowen's disease", 'bowens', 'bowen disease', '鮑文氏病', '鮑恩氏症'], 'carcinoma in situ of skin', '原位癌');
O(['mets', 'metastatic', 'metastasis', 'metastases', 'secondary malignant', '轉移', '轉移性', '遠端轉移', '癌轉移'], 'secondary malignant neoplasm', 'metastatic', 'metastasis', '續發性惡性腫瘤', '轉移');
O(['oral cancer', 'mouth cancer', 'oral cavity cancer', 'oral ca', 'oral cavity ca', 'ocscc', 'oral scc', 'mouth ca', '口腔癌', '口腔惡性腫瘤', '口腔鱗狀細胞癌'], 'malignant neoplasm of mouth', 'malignant neoplasm of oral cavity', '口腔惡性腫瘤');
O(['buccal cancer', 'buccal ca', 'cheek cancer', 'bmca', '頰癌', '頰黏膜癌', '頰粘膜癌'], 'malignant neoplasm of cheek mucosa', 'malignant neoplasm of buccal mucosa');
O(['buccal', 'buccal mucosa', 'cheek mucosa', '頰黏膜', '頰粘膜'], 'cheek mucosa', 'buccal mucosa', '頰粘膜');
O(['tongue cancer', 'tongue ca', 'tongue scc', 'oral tongue', '舌癌', '舌頭癌'], 'malignant neoplasm of tongue', '舌惡性腫瘤');
O(['lip cancer', 'lip ca', 'lip scc', '唇癌', '嘴唇癌'], 'malignant neoplasm of lip', '唇惡性腫瘤');
O(['gum', 'gums', 'gingival', '牙齦', '齒齦'], 'gingiva', 'gum', '牙齦');
O(['gum cancer', 'gingival cancer', 'gingiva cancer', '牙齦癌'], 'malignant neoplasm of gum', '牙齦惡性腫瘤');
O(['fom', 'mouth floor', '口底', '口腔底', '口底癌'], 'floor of mouth', '口底');
O(['hard palate', 'soft palate', '硬顎', '軟顎'], 'palate', '顎');
O(['retromolar', 'retromolar trigone', '臼後三角', '臼齒後三角'], 'retromolar', '臼後');
O(['oropharyngeal', '口咽'], 'oropharynx', '口咽'); O(['oropharyngeal cancer', 'oropharyngeal ca', '口咽癌'], 'malignant neoplasm of oropharynx', '口咽惡性腫瘤');
O(['扁桃腺', '扁桃體'], 'tonsil', '扁桃'); O('舌根', 'base of tongue', '舌根');
O(['hypopharyngeal', 'hypopharynx cancer', '下咽', '下咽癌', '下咽部'], 'hypopharynx', '下咽');
O(['npc', 'nasopharyngeal carcinoma', 'nasopharyngeal ca', '鼻咽癌'], 'malignant neoplasm of nasopharynx', '鼻咽惡性腫瘤');
O(['nasopharyngeal', '鼻咽', '鼻咽部'], 'nasopharynx', '鼻咽');
O(['laryngeal', 'laryngeal cancer', 'voice box', '喉癌', '喉部'], 'larynx', '喉'); G('larynx', '喉');
O(['thyroid cancer', 'thyroid ca', '甲狀腺癌'], 'malignant neoplasm of thyroid gland', '甲狀腺惡性腫瘤'); G('thyroid', '甲狀腺');
G('goiter', '甲狀腺腫');
O(['parotid', 'parotid tumor', '腮腺', '腮腺腫瘤'], 'parotid gland', '腮腺');
O(['salivary', 'salivary gland tumor', '唾液腺', '唾腺'], 'salivary gland', '唾液腺'); O('顎下腺', 'submandibular gland', '顎下腺');
O(['neck dissection', 'rnd', 'mrnd', 'radical neck dissection', 'modified radical neck dissection', '頸部淋巴結廓清', '頸部廓清', '頸廓清', '頸部淋巴廓清'], 'neck dissection', '頸部淋巴結廓清');
O(['mastectomy', 'simple mastectomy', 'total mastectomy', 'mrm', 'modified radical mastectomy', 'radical mastectomy', 'nipple sparing', 'nsm', 'ssm', 'skin sparing mastectomy', '乳房切除', '乳房切除術', '乳房全切除', '乳房全切', '乳房根除'], 'mastectomy', '乳房切除');
O(['lumpectomy', 'partial mastectomy', 'bcs', 'breast conserving', 'breast conservation', 'segmental mastectomy', '乳房部分切除', '乳房腫瘤切除', '乳房局部切除', '保留乳房', '乳房保留手術'], 'partial mastectomy', 'lumpectomy', '乳房部分切除');
O(['breast cancer', 'breast ca', 'ca breast', 'mammary cancer', 'bca', 'ca of breast', '乳癌', '乳房癌', '乳腺癌', '乳房惡性腫瘤'], 'malignant neoplasm of breast', '乳房惡性腫瘤');
O(['dcis', 'ductal carcinoma in situ', 'lcis', 'lobular carcinoma in situ', '乳管原位癌', '乳房原位癌', '導管原位癌'], 'carcinoma in situ of breast', '乳房原位癌');
O(['gynecomastia', 'man boobs', 'male breast enlargement', 'male breast hypertrophy', '男性女乳症', '女乳症', '男性乳房肥大', '男性乳房發育', '男乳女性化', '男性乳房發育症'], 'hypertrophy of breast', '乳房肥大');   // ICD N62 includes gynecomastia
O(['macromastia', 'breast hypertrophy', 'big breast', 'large breast', '巨乳', '巨乳症'], 'hypertrophy of breast', '乳房肥大');
O(['breast reduction', 'reduction mammoplasty', 'reduction mammaplasty', '縮乳', '縮乳手術', '乳房縮小', '乳房縮小術'], 'reduction mammoplasty', '乳房縮小術');
O(['mastopexy', 'breast lift', '乳房上提', '乳房懸吊'], 'mastopexy', '乳房懸吊');
O(['breast augmentation', 'augmentation mammoplasty', '隆乳', '隆乳手術'], 'augmentation mammoplasty', '隆乳');
O(['breast reconstruction', 'breast recon', 'nipple reconstruction', 'nipple areolar reconstruction', 'nac reconstruction', '乳房重建', '乳房再造', '乳頭重建', '乳頭乳暈重建', '乳頭再造'], 'breast reconstruction', 'reconstruction of breast', '乳房重建', '乳頭重建');
G('nipple', '乳頭'); G('areola', '乳暈'); O(['inverted nipple', 'nipple inversion', '乳頭凹陷', '乳頭內陷'], 'retraction of nipple', 'inverted nipple');
O(['breast mass', 'breast lump', '乳房腫塊', '乳房結節'], 'unspecified lump in breast', '乳房腫塊');
O(['fibroadenoma', 'breast fibroadenoma', '纖維腺瘤', '乳房纖維腺瘤'], 'benign neoplasm of breast', '乳房良性腫瘤');
O(['mammary', 'mamma'], 'breast', '乳房'); G('breast', '乳房'); O(['mammoplasty', 'mammaplasty'], 'mammoplasty', 'mammaplasty');
O(['radiotherapy', 'irradiation', 'xrt', 'radiation therapy', 'rtx', '放射線治療', '放射治療', '放療', '電療'], 'radiotherapy', 'radiation therapy', '放射線治療');
O(['chemotherapy', 'chemo', '化學治療', '化療'], 'chemotherapy', '化學治療');
O(['port a', 'port-a', 'port a cath', 'chemoport', 'implantable port', '輸液港', '植入式輸液港', '植入式人工血管', '人工血管植入'], 'central venous catheter', 'insertion of port', '人工血管');

// ------------------------------------------------------------ craniofacial, face, eye, ear, nose, jaw
G('face', '臉'); G('face', '臉部'); G('face', '顏面'); G('facial', '臉部'); G('facial', '顏面');
O(['臉頰', '頰部'], 'cheek'); O(['額頭', '前額'], 'forehead'); O('下巴', 'chin');
G('head', '頭部'); G('neck', '頸部'); G('scalp', '頭皮');
G('skull', '顱骨'); O(['cranium', '頭骨'], 'skull', '顱骨');
O(['scalp wound'], 'open wound of scalp'); O(['scalping'], 'avulsion of scalp');
O(['head injury', 'head trauma', '頭部外傷', '頭部創傷'], 'injury of head', '頭部損傷');
O(['mandible', 'jaw bone', 'jawbone', 'lower jaw', '下顎', '下顎骨', '下頜', '下頜骨'], 'mandible', '下顎骨'); G('mandible', '下顎骨');
O(['jaw fracture', 'broken jaw', 'lower jaw fracture', '下巴骨折', '下顎骨折'], 'fracture of mandible', '下顎骨折');
O(['upper jaw', '上顎', '上顎骨', '上頜', '上頜骨'], 'maxilla', '上顎骨');
O(['勒弗氏骨折', '勒福氏骨折'], 'lefort fracture');
O(['zmc', 'zmc fracture', 'tripod fracture', 'cheekbone', 'cheek bone', 'malar', 'malar fracture', '顴骨', '顴弓'], 'zygoma', 'malar', '顴骨');
O(['nose fracture', 'broken nose', 'nasal fracture', '鼻樑骨折', '鼻梁骨折', '鼻子骨折'], 'fracture of nasal bones', '鼻骨骨折');
O(['blowout', 'blowout fracture', 'blow out fracture', '眼眶爆裂性骨折', '爆裂性骨折'], 'fracture of orbital floor', 'orbital floor');
O(['eye socket', '眼窩', '眼眶'], 'orbit', '眼眶'); G('orbit', '眼眶');
O(['forehead fracture', '額骨骨折'], 'frontal bone');
O(['tmj', 'temporomandibular', 'jaw joint', '顳顎關節', '顳下頜關節'], 'temporomandibular joint', '顳顎關節');
O(['tmj dislocation', '下巴脫臼', '顳顎關節脫臼'], 'dislocation of jaw');
G('cleft lip', '兔唇'); G('cleft lip', '唇裂');
O(['harelip', 'hare lip', '裂唇'], 'cleft lip', '唇裂', '兔唇');
O(['cleft lip repair', 'cheiloplasty', '唇裂修補', '唇裂手術', '兔唇修補', '裂唇成形術'], 'cheiloplasty', '唇裂修補', '唇裂');
O(['cleft lip and palate', 'cleft lip palate', 'clp', 'cl/p', '唇顎裂'], 'cleft palate with cleft lip', '唇顎裂');
O(['cleft palate', 'palatal cleft', 'palate cleft', '顎裂', '裂顎', '腭裂', '齶裂'], 'cleft palate', '顎裂');
O(['palatoplasty', 'palate repair', 'cleft palate repair', '顎裂修補', '顎裂手術', '顎裂成形術'], 'palatoplasty', '顎裂成形術', '顎裂');
O(['vpi', 'vpd', 'velopharyngeal insufficiency', '顎咽閉鎖不全', '顎咽閉合不全'], 'velopharyngeal insufficiency', 'velopharyngeal');
O(['pharyngeal flap', '咽皮瓣'], 'pharyngeal flap', '咽部皮瓣');
O(['microtia', 'small ear', '小耳症', '小耳畸形'], 'microtia', '小耳症');
O(['ear reconstruction', 'ear recon', '耳再造', '耳朵重建', '耳廓重建'], 'ear reconstruction', '耳再造', '外傷性耳成形術');
O(['cup ear', 'lop ear', 'constricted ear', 'ear malformation', 'congenital ear', '耳廓畸形', '先天性耳畸形'], 'congenital malformation of ear', '先天性耳畸形');
O(['otoplasty', 'ear pinning', '耳整形', '耳廓成形術'], 'otoplasty', '耳廓成形', '耳整形');
O(['prominent ear', 'protruding ear', 'bat ear', '突耳', '耳突出', '招風耳', '凸耳'], 'prominent ear', '凸耳');
G('ear', '耳朵'); G('auricle', '耳廓'); O(['pinna', '耳殼'], 'auricle', '耳廓'); O(['earlobe', 'ear lobe', '耳垂'], 'earlobe', 'ear');
O(['眼皮', '上眼瞼', '下眼瞼'], 'eyelid', '眼瞼'); G('eyelid', '眼瞼');
O(['ptosis', 'drooping eyelid', 'droopy eyelid', 'blepharoptosis', 'lid ptosis', 'eyelid ptosis', '眼瞼下垂', '上眼瞼下垂', '眼皮下垂'], 'ptosis of eyelid', '眼瞼下垂');
O(['double eyelid', 'eyelid surgery', 'eye bag', 'eye bags', 'blepharoplasty', '雙眼皮', '割雙眼皮', '眼袋', '眼瞼成形', '眼瞼整形'], 'blepharoplasty', '眼瞼成形術');
O(['dermatochalasis', '上眼瞼鬆弛', '眼皮鬆弛', '眼瞼鬆弛症'], 'dermatochalasis', '眼瞼鬆弛');
G('ectropion', '眼瞼外翻'); G('entropion', '眼瞼內翻');
O(['epicanthal fold', 'epicanthoplasty', '內眥贅皮', '內眼角贅皮'], 'epicanthus', '內眥贅皮');
O(['眼角', '內眼角', '外眼角', 'canthal'], 'canthus', '內眥');
O(['眼睛', '眼球', '眼部'], 'eye', '眼'); O('眼外傷', 'injury of eye and orbit');
O(['tear duct', '鼻淚管'], 'nasolacrimal duct', 'lacrimal duct', '鼻淚管'); O('dcr', 'dacryocystorhinostomy'); O('watery eye', 'epiphora');
O(['nasal', 'nostril', 'nares', '鼻子', '鼻部', '鼻孔'], 'nose', '鼻'); G('nose', '鼻');
O(['nose job', 'septorhinoplasty', '隆鼻', '鼻整形', '鼻成形'], 'rhinoplasty', '鼻成形術');
O(['nasal reconstruction', 'nose reconstruction', '鼻再造', '鼻重建'], 'reconstruction of nose', '鼻再造');
O(['deviated septum', 'septoplasty', '鼻中膈彎曲', '鼻中隔彎曲'], 'deviated nasal septum', 'septoplasty', '鼻中膈鼻道成形術');
O(['saddle nose', 'nasal deformity'], 'acquired deformity of nose');
O(['lips', '嘴唇', '口唇', '唇部'], 'lip', '唇'); G('lip', '唇');
G('mouth', '口腔'); O(['oral cavity', 'buccal cavity', 'intraoral'], 'mouth', '口腔'); O('嘴巴', 'mouth', '口腔');
G('tongue', '舌'); O('舌頭', 'tongue', '舌'); O(['tongue tie', 'ankyloglossia', '舌繫帶過短', '舌黏連', '舌繫帶沾黏'], 'ankyloglossia', '舌繫帶');
G('tooth', '牙齒'); O(['teeth', '牙'], 'tooth', '牙齒');
O(['neck mass', 'neck lump', '頸部腫塊'], 'localized swelling mass lump neck', '頸部腫塊'); O(['脖子', '頸'], 'neck', '頸部');
O(['face lift', 'facelift', 'rhytidectomy', 'face lifting', '拉皮', '拉臉', '臉部拉皮'], 'rhytidectomy', '拉皮');
O(['wrinkle', 'wrinkles', '皺紋', '除皺'], 'wrinkles', '皺紋');
O(['scaphocephaly', 'trigonocephaly', 'brachycephaly', 'craniostenosis', '顱縫早閉', '顱縫早期閉合'], 'craniosynostosis', '顱骨縫過早封閉');
O('craniosynostosis', '顱骨縫過早封閉');
O(['hfm', 'hemifacial microsomia', '半側顏面短小症', '半側顏面發育不全'], 'hemifacial microsomia');
O(['facial asymmetry', 'face asymmetry', '顏面不對稱', '臉部不對稱'], 'facial asymmetry');
O(['orthognathic', 'orthognathic surgery', 'jaw surgery', 'bsso', 'sagittal split', 'genioplasty', '正顎', '正顎手術', '頦成形'], 'orthognathic surgery', '正顎手術');
O(['malocclusion', 'overbite', 'underbite', '暴牙', '戽斗', '咬合不正'], 'malocclusion', '咬合不正');
G('osteotomy', '切骨術'); O(['osteotomies', '截骨', '截骨術', '切骨', '骨切開'], 'osteotomy', '切骨術');
G('facial nerve', '顏面神經'); O(['facial reanimation', 'smile reconstruction', '顏面神經重建', '微笑重建'], 'facial nerve', '顏面神經');
O(['nerve transfer', '神經轉移', '神經轉位'], 'nerve transfer', '神經轉位');
O(['hair transplant', 'hair restoration', 'follicular unit', 'fue', 'fut', 'hair grafting', '植髮', '毛髮移植', '植髮手術', '頭髮移植'], 'hair transplant', '毛髮移植');
O(['tattoo', 'tattoos', 'tattoo removal', 'traumatic tattoo', '刺青', '紋身', '紋身移除', '刺青移除'], 'tattoo', '刺青');
G('pectus excavatum', '漏斗胸'); G('pectus carinatum', '雞胸');
G('chest wall', '胸壁'); G('sternum', '胸骨'); O('sternal', 'sternum', '胸骨'); O('胸部', 'chest', '胸'); O(['縱膈腔炎', '縱隔炎'], 'mediastinitis', '縱膈炎');
G('rib', '肋骨'); O(['ribs', 'broken rib'], 'rib', '肋骨', 'fracture of rib');
O(['背', '背部', '後背', '腰背', '上背', '下背'], 'back', '軀幹', '背部');   // spec: 背 -> 軀幹
O(['torso', '軀體'], 'trunk', '軀幹'); G('trunk', '軀幹');
O(['belly', 'tummy', '肚子'], 'abdomen', '腹部'); O('腹', 'abdomen', '腹部'); O('腹壁', 'abdominal wall');
O(['navel', 'belly button', '肚臍'], 'umbilicus', '臍');
O(['abdominoplasty', 'tummy tuck', '腹部整形', '腹壁整形', '拉腹'], 'abdominoplasty', '腹壁整形');
O(['panniculectomy'], 'panniculectomy', '腹壁整形');
O(['疝氣', '疝'], 'hernia'); O(['切口疝氣', '傷口疝氣'], 'incisional hernia', '切口疝'); O(['腹壁疝氣', '腹壁疝'], 'ventral hernia', '腹壁疝');
O(['diastasis recti', '腹直肌分離'], 'separation of muscle');
O(['鼠蹊', '鼠蹊部', '腹股溝'], 'groin', 'inguinal', '腹股溝');
O(['會陰', '會陰部'], 'perineum', '會陰'); O('外陰', 'vulva', '外陰'); O('陰囊', 'scrotum', '陰囊'); O('陰莖', 'penis', '陰莖'); O('陰道', 'vagina', '陰道'); O('陰唇', 'labia', '陰唇'); O('生殖器', 'genital', '生殖器');
O(['butt', 'bum', 'buttocks', '屁股', '臀部', '臀'], 'buttock', '臀');
O(['sacrum', 'sacral', '薦骨', '薦椎', '骶骨', '薦部', '尾骶部'], 'sacral region', 'sacrum', '薦骨');
O(['肩膀', '肩部', '肩'], 'shoulder'); G('shoulder', '肩');
O(['ac joint', '肩鎖關節'], 'acromioclavicular', '肩鎖關節');
G('axilla', '腋窩'); O(['armpit', 'underarm', 'under arm', '腋下', '腋部'], 'axilla', '腋窩');
G('upper arm', '上臂'); O('upperarm', 'upper arm', '上臂');
O('手臂', 'upper limb', 'arm', '上肢');
G('elbow', '肘'); O(['手肘', '肘部', '肘關節'], 'elbow', '肘'); O(['鷹嘴', '尺骨鷹嘴'], 'olecranon', '鷹嘴');
G('forearm', '前臂'); O(['fore arm', 'lower arm', 'antebrachium', '小臂', '前手臂', '下臂'], 'forearm', '前臂');
G('wrist', '腕'); O(['手腕', '腕部', '腕關節', 'carpus'], 'wrist', '腕');
G('hand', '手部'); O('手', 'hand', '手部');
G('back of hand', '手背'); O(['dorsum of hand', 'hand dorsum'], 'back of hand', '手背');
G('palm', '手掌'); O(['palmar', '掌側', '掌部'], 'palm', '手掌');
G('finger', '手指'); O(['fingers', 'digit', 'digits', '指頭', '指'], 'finger', '手指');
G('phalanx', '指骨'); G('phalanx', 'phalanges'); O(['phalangeal', 'phalange', '指節'], 'phalanx', 'phalanges', '指骨');
G('thumb', '拇指'); O(['thumbs', 'pollex', '大拇指', '姆指', '大拇哥'], 'thumb', '拇指');
O(['index', 'index finger', 'forefinger', 'pointer finger', 'second finger', '食指', '示指'], 'index finger', '食指'); G('index finger', '食指');
O(['middle finger', 'long finger', 'third finger', '中指'], 'middle finger', '中指'); G('middle finger', '中指');
O(['ring finger', 'fourth finger', '環指', '無名指'], 'ring finger', '無名指'); G('ring finger', '無名指');
O(['little finger', 'pinky', 'pinkie', 'small finger', 'fifth finger', 'baby finger', '小指', '小姆指', '尾指', '小拇指'], 'little finger', '小指'); G('little finger', '小指');
O(['fingertip', 'fingertips', 'finger tip', 'finger tips', 'digit tip', 'finger pulp', '指尖', '指端', '指頭尖', '指腹', '指末端'], 'finger', '手指');
O(['nail bed injury', '甲床損傷', '指甲損傷'], 'damage to nail');
O(['prox phalanx', 'proximal phalange', '近節指骨', '近節'], 'proximal phalanx', '近端指骨');
O(['middle phalanx', 'mid phalanx', '中節指骨', '中節'], 'middle phalanx', '中節指骨');
O(['distal phalange', '遠節指骨', '末節指骨', 'terminal phalanx'], 'distal phalanx', '遠端指骨');
O(['dip', 'dip joint', '遠端指間關節'], 'distal interphalangeal', 'interphalangeal', '指間關節');
O(['pip', 'pip joint', '近端指間關節', 'pip關節'], 'proximal interphalangeal', 'interphalangeal', '指間關節');
O(['mcp', 'mcp joint', 'mcpj', 'knuckle', 'knuckles', '掌指關節', '指關節', '指節關節'], 'metacarpophalangeal', '掌指關節');
O(['cmc', 'cmc joint', 'thumb base', 'thumb basal joint', '腕掌關節', '拇指基底關節', '拇指根部'], 'carpometacarpal', '腕掌關節');
G('toe', '足趾'); O(['toes', '腳趾', '趾頭', '腳指頭', '足趾頭'], 'toe', '足趾');
O(['hallux', 'big toe', 'great toe', '大腳趾', '拇趾'], 'great toe', 'toe', '足趾');
O(['足', '腳', '腳掌', '足部'], 'foot', '足部');
G('ankle', '踝'); O(['腳踝', '踝部', '踝關節'], 'ankle', '踝'); O('外踝', 'lateral malleolus'); O('內踝', 'medial malleolus');
G('heel', '足跟'); O(['腳跟', '後跟', '腳後跟'], 'heel', '足跟');
O(['leg', 'legs', '小腿', '下肢', '腿', '腿部', '下肢部'], 'lower leg', 'lower limb', '小腿', '下肢');
O(['lower extremity', 'lower extremities'], 'lower limb', '下肢');
O(['calf', 'calves', '小腿肚'], 'lower leg', '小腿');
O(['popliteal fossa', 'back of knee', '膕窩', '膕部', '膝後'], 'popliteal', '膕');
G('thigh', '大腿'); G('knee', '膝'); G('knee', '膝部'); O('膝蓋', 'knee', '膝');
O(['hip joint', '髖關節', '髖部', '髖'], 'hip'); O('骨盆', 'pelvis', '骨盆'); O('髖臼', 'acetabulum'); O('髂骨', 'ilium');
O(['upper extremity', 'upper extremities', 'whole arm', 'whole upper limb', '上肢部', '整隻手', '整隻手臂'], 'upper limb', '上肢');
G('limb', '肢體');
O(['multi site', 'multisite', '多部位', '多個部位'], 'multiple sites', '多處'); O('多發性', 'multiple', '多發');
O(['cutaneous'], 'skin', '皮膚');
O(['subcutis', 'hypodermis', '皮下組織'], 'subcutaneous tissue', '皮下組織');
O(['muscles', 'muscular'], 'muscle', '肌肉'); O(['bones', '骨頭', '骨骼'], 'bone', '骨'); O('joints', 'joint', '關節');

// Containing region as LAST (broadest) target, where the ICD index sends the site to the limb/head/trunk region
// (e.g. Cellulitis, hand -> L03.11- "other parts of limb"; Lipoma, back -> D17.1 trunk; Laceration, face -> "other part of head").
O(['hand', 'palm', 'wrist', 'forearm', 'elbow', 'upper arm', 'arm', '手', '手部', '手掌', '手背', '腕', '手腕', '前臂', '肘', '上臂', '手臂'], 'upper limb', '上肢');
O(['foot', 'ankle', 'thigh', 'knee', 'heel', 'toe', 'calf', '足', '腳', '足部', '踝', '大腿', '膝', '足跟', '小腿'], 'lower limb', '下肢');
O(['back'], 'trunk', '軀幹');
O(['face', 'facial', '臉', '臉部', '顏面'], 'other part of head');
O(['forehead', 'chin', '額頭', '前額', '下巴'], 'other part of head');

// ------------------------------------------------------------ anesthesia, services, investigations (NHI)
O(['regional block', 'brachial block', 'axillary block', 'digital block', 'wrist block', 'ring block', '神經阻滯', '神經阻斷', '指神經阻斷', '臂神經叢阻斷'], 'nerve block', '神經阻斷');
O(['local anaesthesia', 'local anesthetic', '局麻', '局部麻醉'], 'local anesthesia', '局部麻醉');
O(['ga', 'general anaesthesia', '全麻', '全身麻醉'], 'general anesthesia', '全身麻醉');
O(['spinal anesthesia', 'spinal anaesthesia', '脊椎麻醉', '半身麻醉', '腰椎麻醉', '脊髓麻醉'], 'spinal anesthesia', '脊髓麻醉');
O(['epidural anesthesia', '硬膜外麻醉', '硬脊膜外麻醉'], 'epidural anesthesia', '硬脊膜外麻醉');
G('anesthesia', '麻醉'); O(['anesthetic', 'anesth', 'anes', 'anaesth', '麻藥', '麻醉費'], 'anesthesia', '麻醉');
O(['consult', 'consults', '照會', '會診費', '照會費'], 'consultation', '會診'); G('consultation', '會診');
O(['opd', 'clinic visit', 'office visit', 'outpatient visit', '看診', '診察', '診察費'], 'outpatient', '門診診察費');
G('inpatient', '住院'); O(['hospital stay', '入院'], 'inpatient', '住院'); O(['room charge', 'ward fee', '病房費'], '病房費');
O(['er', 'emergency room', 'emergency department', '急診室'], 'emergency', '急診'); G('emergency', '急診');
O(['icu', 'micu', 'sicu', 'picu', 'nicu', 'ccu', '加護'], 'intensive care', '加護病房'); G('intensive care', '加護病房');
O(['xray', 'x ray', 'x-ray', 'radiograph', 'plain film', 'radiography', 'xr', 'roentgen', 'x光片', 'x 光', '照x光'], 'x-ray', 'x光');
O(['cxr', 'chest x ray', 'chest xray', 'chest film', 'chest radiograph', '胸部x光', '胸腔x光', '胸部攝影', '胸腔攝影'], 'chest view', '胸腔檢查');
O(['ct', 'cat scan', 'computed tomography', 'ct scan', '電腦斷層', '電腦斷層攝影', '斷層掃描', '電腦斷層掃描'], 'computed tomography', '電腦斷層');
O(['mri', 'magnetic resonance', 'mr imaging', 'nuclear magnetic resonance', 'nmr', '核磁共振', '磁振造影', '核磁', '磁振攝影'], 'magnetic resonance', '磁振造影', '核磁共振');
O(['us', 'ultrasound', 'sonography', 'doppler', 'duplex', 'ultrasonography', '超音波', '超聲波', '都卜勒', '都普勒', '彩色超音波', '超音波檢查'], 'ultrasound', 'ultrasonography', '超音波');
O(['ekg', 'ecg', 'electrocardiogram', 'electrocardiography', 'e.k.g', '心電圖'], 'electrocardiography', 'e.k.g', '心電圖');
O(['cbc', 'complete blood count', 'cbc dc', 'cbc/dc', 'full blood count', 'fbc', '血液常規', '全套血液', '全套血液檢查', '血球計數', '驗血'], 'complete blood count', 'cbc', '全套血液檢查', '血液檢查');
O(['crp', 'c reactive protein', 'c-reactive protein', '發炎指數', 'c反應蛋白'], 'c-reactive protein', 'crp', 'c反應蛋白');
O(['esr', 'sed rate', '血沉'], 'erythrocyte sedimentation rate', 'esr', '血沉');
O(['blood sugar', 'ac sugar', 'pc sugar', 'dxt', '血糖', '飯前血糖', '飯後血糖'], 'glucose', '血糖');
O(['hba1c', 'a1c', 'glycohemoglobin', '糖化血色素'], 'glycosylated hemoglobin', '糖化血色素');
O(['lft', 'liver function', 'liver enzyme', '肝功能', '肝指數', '肝臟功能', '肝功能檢查'], 'liver function', '肝功能');
O(['sgot', 'ast'], 'got'); O(['sgpt'], 'gpt');
O(['kft', 'renal function', 'kidney function', '腎功能', '腎臟功能', '腎功能檢查'], 'renal function', '腎功能');
O(['bun', '尿素氮'], 'blood urea nitrogen', '尿素氮'); G('creatinine', '肌酸酐');
O(['inr', 'prothrombin'], 'prothrombin time', '凝血酶原時間'); O(['ptt', 'aptt'], 'partial thromboplastin time');
O(['cultures', 'c/s', 'wound culture', 'tissue culture', '傷口培養', '組織培養'], 'bacterial culture', '細菌培養', '培養'); G('culture', '培養');
G('pathology', '病理'); G('frozen section', '冰凍切片'); O(['histopathology', 'tissue pathology', '病理檢查', '組織病理', '病理學'], 'pathology', '病理');
O(['ua', 'urine routine', 'urine exam', '尿液常規', '驗尿', '尿液檢查'], 'urinalysis', '尿液檢查');
G('transfusion', '輸血'); O(['blood transfusion', 'prbc', 'packed red cells', 'ffp transfusion', '輸血費'], 'transfusion', '輸血'); O(['platelet transfusion', '血小板輸注'], 'platelet transfusion', '輸血');
O(['rehab', 'rehabilitation', '復健', '復健治療'], 'rehabilitation', '復健');
G('physical therapy', '物理治療'); O(['physiotherapy', 'pt therapy', '物療'], 'physical therapy', '物理治療');
G('occupational therapy', '職能治療'); O(['hand therapy', 'hand rehab', '手部復健', '手治療', '職能'], 'occupational therapy', '職能治療');
O(['orthotic', 'orthotics', '矯具', '矯正器', '裝具'], 'orthosis', '矯具');
O(['splint fabrication', 'thermoplastic splint', 'custom splint', '副木製作'], 'splint', '副木');
O(['artificial limb', 'artificial leg', 'artificial arm', 'prosthetic limb', '義肢', '假肢', '義足', '義手', '假腳', '假手'], 'artificial limb', '義肢');
G('cosmetic', '美容'); O(['aesthetic', 'esthetic', 'cosmetic surgery', 'aesthetic surgery', '醫美', '美容手術'], 'cosmetic', '美容');

// ------------------------------------------------------------ SPEC 8.2 rupture / tear wording
O(['rupture', 'ruptured', 'ruptures'], 'laceration', 'strain');   // user decision: traumatic tendon rupture is coded as laceration (prefer map)
O(['tear', 'torn', 'tears'], 'strain', 'sprain');
O('斷裂', '撕裂傷', '拉傷'); O('撕裂', '拉傷', '撕裂傷');

// ------------------------------------------------------------ lead review (2026-11-18)
// Diagnosis or lay word typed in the NHI tab -> the procedure wording the fee schedule actually uses.
// Targets are strings that occur only in NHI names, so ICD results are unaffected.
O(['cleft lip', '唇裂', '兔唇', '唇顎裂'], 'cheiloplasty', '裂唇成形術');      // 88043B-88045B
O(['cleft palate', '顎裂', '腭裂'], 'palatoplasty', '補顎術');                  // 92207B
O(['狐臭', '腋臭', 'osmidrosis', 'bromhidrosis'], '腋下汗腺切除術');            // 62021C
O(['ingrown nail', 'ingrown toenail', '嵌甲', '凍甲'], '拔指甲');               // 56006C
O(['sebaceous cyst', 'epidermal cyst', 'epidermoid cyst', '粉瘤', '表皮囊腫', '皮脂腺囊腫'], 'subcutaneous tumor', '皮下腫瘤');
O(['melanoma', '黑色素瘤', 'bcc', 'scc', 'skin cancer', '皮膚癌'], '皮膚惡性腫瘤切除');
O(['keloid', '蟹足腫', 'hypertrophic scar', '肥厚性疤痕'], '疤痕注射', '瘢痕攣縮');
O('甲溝炎', '手指蜂窩組織炎', '腳趾蜂窩組織炎');                               // ICD: paronychia -> cellulitis of digit
O('下巴', '下頷', '下顎');                                                     // ICD 下頷骨 / NHI 下顎骨

// ------------------------------------------------------------ anatomy: body SITES only (carries a site across a compound query); no laterality, no pathology
const anatomy = ('hand wrist forearm elbow arm shoulder finger fingers thumb index middle ring little pinky palm hip thigh knee leg ankle foot toe toes heel face scalp head neck chest abdomen back buttock eyelid lip nose ear ' +
  'cheek chin forehead jaw mandible trunk groin axilla calf shin sole nail breast sacrum sacral orbit tongue skull pelvis ' +
  '手 手部 手掌 手背 腕 手腕 前臂 肘 上臂 手臂 肩 手指 拇指 食指 中指 無名指 小指 髖 大腿 膝 小腿 踝 足 腳 趾 腳趾 足跟 臉 顏面 頭皮 頭 頸 胸 腹 背 臀 眼瞼 唇 鼻 耳 頰 下巴 額 腋 腹股溝 軀幹 下肢 上肢 乳房 薦骨 眼眶 舌').split(' ');

// ------------------------------------------------------------ user decision (SPEC 8.2): keep exactly
const prefer = { rupture: 'laceration', ruptured: 'laceration', 斷裂: '撕裂傷' };

module.exports = { groups, oneway, anatomy, prefer };

if (require.main === module) {
  const fs = require('fs'), path = require('path');
  const root = path.resolve(__dirname, '..');
  const { loadEngine } = require(path.join(root, 'tests', 'common.js'));
  const { eng } = loadEngine({ noLexicon: true });
  const norm = s => String(s).normalize('NFKC').toLowerCase().replace(/臺/g, '台').replace(/\s+/g, ' ').trim();
  const cache = new Map();
  const live = t => { const k = norm(t); if (!cache.has(k)) cache.set(k, eng.probe('nhi', k) + eng.probe('icd', k) > 0); return cache.get(k); };
  const dead = [];
  const ow = {};
  for (const k of Object.keys(oneway).sort()) {
    const t = Array.from(new Set(oneway[k])).filter(x => x !== k && (live(x) || (dead.push(`${k} -> ${x}`), false)));
    if (t.length) ow[k] = t; else dead.push(`${k} (no live target)`);
  }
  const gs = [], seen = new Set();
  for (const g of groups) {
    const m = Array.from(new Set(g)).filter(x => live(x) || (dead.push(`group member ${x}`), false));
    const key = m.slice().sort().join('\u0001');
    if (m.length > 1 && !seen.has(key)) { seen.add(key); gs.push(m); }
  }
  for (const k of Object.keys(prefer)) if (!(ow[k] || []).includes(prefer[k])) { console.error('prefer target missing from oneway: ' + k); process.exit(1); }
  const out = '{"v":1,\n"groups":[\n' + gs.map(g => JSON.stringify(g)).join(',\n') + '\n],\n"oneway":{\n' +
    Object.keys(ow).map(k => JSON.stringify(k) + ':' + JSON.stringify(ow[k])).join(',\n') + '\n},\n"anatomy":' + JSON.stringify(anatomy) + ',\n"prefer":' + JSON.stringify(prefer) + '}\n';
  fs.writeFileSync(path.join(root, 'lexicon.json'), out);
  console.log(`lexicon.json: groups ${gs.length}, oneway ${Object.keys(ow).length}; pruned dead items: ${dead.length}`);
  if (process.argv.includes('--dead')) dead.forEach(d => console.log('  DEAD ' + d));
}
