import { Database } from 'bun:sqlite'
import fs from 'fs/promises'
import { join } from 'path'
import { exit } from 'process'
import { abbreviateGreekLetter, CATALOG } from 'api/sky/designations'
import { createSkyCatalogSchema, writeSkyCatalogMeta } from 'api/sky/schema'
import { simbadQuery } from 'nebulosa/src/adapters/catalogs/simbad'
import { type Constellation, CONSTELLATION_LIST, constellation } from 'nebulosa/src/astronomy/coordinates/constellation'
import { readHygCatalog } from 'nebulosa/src/catalogs/stars/hyg'
import { readCatalogDat, readNamesDat, StellariumObjectType } from 'nebulosa/src/catalogs/stars/stellarium/nebulae'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { type Angle, deg, mas } from 'nebulosa/src/math/units/angle'
import type { Distance } from 'nebulosa/src/math/units/distance'
import { kilometerPerSecond, type Velocity } from 'nebulosa/src/math/units/velocity'

// Generates the sky catalog database (api/data/sky.catalog.db) embedded by the API: every HYG star up to
// STAR_MAGNITUDE_LIMIT, the Stellarium deep-sky catalog, and the star clusters of SIMBAD, with their
// designations in every known catalog. Source files are downloaded once into api/data and reused. The
// database is written to a temporary file and only replaces the previous one when generation succeeds.
// Usage: bun make:catalog [--force]

const { NAME, NGC, IC, BAYER, FLAMSTEED, HD, HR, HIP, M, C, B, SH2, LBN, LDN, MEL, CR, ARP, PGC, TR, ST, RU, UGC, CED, RCW, VDB, VV, PK, PNG, ACO, ESO, SNRG, DWB, BENNETT, DUNLOP, HERSCHEL, GUM } = CATALOG

// Faintest visual magnitude of the HYG stars included; 8 keeps about 41 500 stars.
const STAR_MAGNITUDE_LIMIT = 8

// Offset added to Stellarium deep-sky ids so they never collide with HYG star ids (below 1 000 000).
const STELLARIUM_ID_OFFSET = 1_000_000

// Offset added to SIMBAD oids for star clusters that are not in the Stellarium catalog.
const SIMBAD_ID_OFFSET = 100_000_000

// Bennett catalog entries as [Bennett number, catalog code, designation]: https://www.docdb.net/tutorials/bennett_catalogue.php
const BENNETT_CATALOG: [string, number, string][] = [
	['1', NGC, '55'],
	['2', NGC, '104'],
	['3', NGC, '247'],
	['4', NGC, '253'],
	['5', NGC, '288'],
	['6', NGC, '300'],
	['7', NGC, '362'],
	['8', NGC, '613'],
	['9', NGC, '1068'],
	['10', NGC, '1097'],
	['10A', NGC, '1232'],
	['11', NGC, '1261'],
	['12', NGC, '1291'],
	['13', NGC, '1313'],
	['14', NGC, '1316'],
	['14A', NGC, '1350'],
	['15', NGC, '1360'],
	['16', NGC, '1365'],
	['17', NGC, '1380'],
	['18', NGC, '1387'],
	['19', NGC, '1399'],
	['19A', NGC, '1398'],
	['20', NGC, '1404'],
	['21', NGC, '1433'],
	['21A', NGC, '1512'],
	['22', NGC, '1535'],
	['23', NGC, '1549'],
	['24', NGC, '1553'],
	['25', NGC, '1566'],
	['25A', NGC, '1617'],
	['26', NGC, '1672'],
	['27', NGC, '1763'],
	['28', NGC, '1783'],
	['29', NGC, '1792'],
	['30', NGC, '1818'],
	['31', NGC, '1808'],
	['32', NGC, '1851'],
	['33', NGC, '1866'],
	['34', NGC, '1904'],
	['35', NGC, '2070'],
	['36', NGC, '2214'],
	['36A', NGC, '2243'],
	['37', NGC, '2298'],
	['37A', NGC, '2467'],
	['38', NGC, '2489'],
	['39', NGC, '2506'],
	['40', NGC, '2627'],
	['40A', NGC, '2671'],
	['41', NGC, '2808'],
	['41A', NGC, '2972'],
	['41B', NGC, '2997'],
	['42', NGC, '3115'],
	['43', NGC, '3132'],
	['44', NGC, '3201'],
	['45', NGC, '3242'],
	['46', NGC, '3621'],
	['47', MEL, '105'],
	['48', NGC, '3960'],
	['49', NGC, '3923'],
	['50', NGC, '4372'],
	['51', NGC, '4590'],
	['52', NGC, '4594'],
	['53', NGC, '4697'],
	['54', NGC, '4699'],
	['55', NGC, '4753'],
	['56', NGC, '4833'],
	['57', NGC, '4945'],
	['58', NGC, '4976'],
	['59', NGC, '5061'],
	['59A', NGC, '5068'],
	['60', NGC, '5128'],
	['61', NGC, '5139'],
	['62', NGC, '5189'],
	['63', NGC, '5236'],
	['63A', NGC, '5253'],
	['64', NGC, '5286'],
	['65', NGC, '5617'],
	['66', NGC, '5634'],
	['67', NGC, '5824'],
	['68', NGC, '5897'],
	['69', NGC, '5927'],
	['70', NGC, '5986'],
	['71', NGC, '5999'],
	['72', NGC, '6005'],
	['72A', TR, '23'],
	['73', NGC, '6093'],
	['74', NGC, '6101'],
	['75', NGC, '6121'],
	['76', NGC, '6134'],
	['77', NGC, '6144'],
	['78', NGC, '6139'],
	['79', NGC, '6171'],
	['79A', NGC, '6167'],
	['79B', NGC, '6192'],
	['80', NGC, '6218'],
	['81', NGC, '6216'],
	['82', NGC, '6235'],
	['83', NGC, '6254'],
	['84', NGC, '6253'],
	['85', NGC, '6266'],
	['86', NGC, '6273'],
	['87', NGC, '6284'],
	['88', NGC, '6287'],
	['89', NGC, '6293'],
	['90', NGC, '6304'],
	['91', NGC, '6316'],
	['91A', NGC, '6318'],
	['92', NGC, '6333'],
	['93', NGC, '6356'],
	['94', NGC, '6352'],
	['95', NGC, '6362'],
	['96', NGC, '6388'],
	['97', NGC, '6402'],
	['98', NGC, '6397'],
	['98A', NGC, '6440'],
	['98B', NGC, '6445'],
	['99', NGC, '6441'],
	['100', NGC, '6496'],
	['101', NGC, '6522'],
	['102', NGC, '6528'],
	['103', NGC, '6544'],
	['104', NGC, '6541'],
	['105', NGC, '6553'],
	['106', NGC, '6569'],
	['107', NGC, '6584'],
	['107A', NGC, '6603'],
	['108', NGC, '6618'],
	['109', NGC, '6624'],
	['110', NGC, '6626'],
	['111', NGC, '6638'],
	['112', NGC, '6637'],
	['112A', NGC, '6642'],
	['113', NGC, '6652'],
	['114', NGC, '6656'],
	['115', NGC, '6681'],
	['116', NGC, '6705'],
	['117', NGC, '6712'],
	['118', NGC, '6715'],
	['119', NGC, '6723'],
	['120', NGC, '6744'],
	['121', NGC, '6752'],
	['122', NGC, '6809'],
	['123', NGC, '6818'],
	['124', NGC, '6864'],
	['125', NGC, '6981'],
	['126', NGC, '7009'],
	['127', NGC, '7089'],
	['128', NGC, '7099'],
	['129', NGC, '7293'],
	['129A', NGC, '7410'],
	['129B', IC, '1459'],
	['130', NGC, '7793'],
]

// Dunlop catalog entries as [Dunlop number, catalog code, designation]: https://www.docdb.net/tutorials/dunlop_catalogue.php
const DUNLOP_CATALOG: [string, number, string][] = [
	['1', NGC, '7590'],
	['2', NGC, '7599'],
	['18', NGC, '104'],
	['23', NGC, '330'],
	['25', NGC, '346'],
	['62', NGC, '362'],
	['68', NGC, '6101'],
	['81', NGC, '1795'],
	['90', NGC, '1943'],
	['98', NGC, '2019'],
	['102', NGC, '2058'],
	['106', NGC, '2122'],
	['114', NGC, '1743'],
	['129', NGC, '1910'],
	['131', NGC, '1928'],
	['136', NGC, '1966'],
	['142', NGC, '2070'],
	['143', NGC, '2069'],
	['160', NGC, '2136'],
	['164', NGC, '4833'],
	['167', NGC, '1755'],
	['169', NGC, '1770'],
	['175', NGC, '1936'],
	['193', NGC, '2159'],
	['194', NGC, '2164'],
	['196', NGC, '2156'],
	['201', NGC, '2214'],
	['206', NGC, '1313'],
	['210', NGC, '1869'],
	['211', NGC, '1955'],
	['213', NGC, '1974'],
	['215', NGC, '2004'],
	['218', NGC, '2121'],
	['220', NGC, '2035'],
	['225', NGC, '6362'],
	['235', NGC, '1810'],
	['236', NGC, '1818'],
	['240', NGC, '2029'],
	['241', NGC, '2027'],
	['246', NGC, '1831'],
	['262', NGC, '6744'],
	['265', NGC, '2808'],
	['272', NGC, '4609'],
	['273', NGC, '5281'],
	['282', NGC, '5316'],
	['289', NGC, '3766'],
	['291', NGC, '4103'],
	['292', NGC, '4349'],
	['295', NGC, '6752'],
	['297', NGC, '3114'],
	['301', NGC, '4755'],
	['302', NGC, '5617'],
	['304', NGC, '6025'],
	['309', NGC, '3372'],
	['311', NGC, '4852'],
	['313', NGC, '5606'],
	['323', NGC, '3532'],
	['326', NGC, '6087'],
	['333', NGC, '5715'],
	['334', NGC, '6005'],
	['337', NGC, '1261'],
	['342', NGC, '5662'],
	['343', NGC, '5999'],
	['348', NGC, '1515'],
	['349', NGC, '3960'],
	['355', NGC, '3330'],
	['356', NGC, '5749'],
	['357', NGC, '5925'],
	['359', NGC, '6031'],
	['360', NGC, '6067'],
	['364', NGC, '6208'],
	['366', NGC, '6397'],
	['376', NGC, '6584'],
	['386', NGC, '3228'],
	['388', NGC, '5286'],
	['389', NGC, '5927'],
	['397', NGC, '2972'],
	['400', NGC, '6167'],
	['406', NGC, '7049'],
	['410', NGC, '2547'],
	['411', NGC, '4945'],
	['412', NGC, '6134'],
	['413', NGC, '6193'],
	['417', NGC, '6352'],
	['425', NGC, '6861'],
	['426', NGC, '1433'],
	['431', NGC, '5460'],
	['438', NGC, '1493'],
	['440', NGC, '5139'],
	['442', NGC, '6204'],
	['445', NGC, '3201'],
	['454', NGC, '6216'],
	['456', NGC, '6259'],
	['457', NGC, '6388'],
	['466', NGC, '1512'],
	['469', NGC, '5643'],
	['473', NGC, '6541'],
	['479', NGC, '625'],
	['480', NGC, '1487'],
	['481', NGC, '3680'],
	['482', NGC, '5128'],
	['483', NGC, '6192'],
	['487', NGC, '1291'],
	['499', NGC, '6231'],
	['507', NGC, '55'],
	['508', NGC, '1851'],
	['511', NGC, '4709'],
	['514', NGC, '6124'],
	['518', NGC, '7410'],
	['520', NGC, '6242'],
	['521', NGC, '6268'],
	['522', NGC, '6318'],
	['535', NGC, '2477'],
	['536', NGC, '6139'],
	['547', NGC, '1317'],
	['548', NGC, '1316'],
	['549', NGC, '1808'],
	['552', NGC, '5986'],
	['556', NGC, '6281'],
	['557', NGC, '6441'],
	['562', NGC, '1436'],
	['563', NGC, '2546'],
	['564', NGC, '2818'],
	['568', NGC, '6400'],
	['573', NGC, '6723'],
	['574', NGC, '1380'],
	['578', NGC, '2298'],
	['591', NGC, '1350'],
	['594', NGC, '2090'],
	['600', NGC, '1532'],
	['607', NGC, '6652'],
	['609', NGC, '2658'],
	['612', NGC, '6416'],
	['613', NGC, '6637'],
	['614', NGC, '6681'],
	['617', NGC, '3621'],
	['619', NGC, '6569'],
	['620', NGC, '6809'],
	['623', NGC, '5253'],
	['624', NGC, '6715'],
	['626', NGC, '2489'],
	['627', NGC, '6266'],
	['628', NGC, '5236'],
]

// Herschel 400 entries as [Herschel number, catalog code, designation]: https://www.go-astronomy.com/herschel-objects.htm
const HERSCHEL_CATALOG: [string, number, string][] = [
	['1', NGC, '40'],
	['2', NGC, '129'],
	['3', NGC, '136'],
	['4', NGC, '157'],
	['5', NGC, '185'],
	['6', NGC, '205'],
	['7', NGC, '225'],
	['8', NGC, '246'],
	['9', NGC, '247'],
	['10', NGC, '253'],
	['11', NGC, '278'],
	['12', NGC, '288'],
	['13', NGC, '381'],
	['14', NGC, '404'],
	['15', NGC, '436'],
	['16', NGC, '457'],
	['17', NGC, '488'],
	['18', NGC, '524'],
	['19', NGC, '559'],
	['20', NGC, '584'],
	['21', NGC, '596'],
	['22', NGC, '598'],
	['23', NGC, '613'],
	['24', NGC, '615'],
	['25', NGC, '637'],
	['26', NGC, '650'],
	['26', NGC, '651'],
	['27', NGC, '654'],
	['28', NGC, '659'],
	['29', NGC, '663'],
	['30', NGC, '720'],
	['31', NGC, '752'],
	['32', NGC, '772'],
	['33', NGC, '779'],
	['34', NGC, '869'],
	['35', NGC, '884'],
	['36', NGC, '891'],
	['37', NGC, '908'],
	['38', NGC, '936'],
	['39', NGC, '1022'],
	['40', NGC, '1023'],
	['41', NGC, '1027'],
	['42', NGC, '1052'],
	['43', NGC, '1055'],
	['44', NGC, '1084'],
	['45', NGC, '1245'],
	['46', NGC, '1342'],
	['47', NGC, '1407'],
	['48', NGC, '1444'],
	['49', NGC, '1501'],
	['50', NGC, '1502'],
	['51', NGC, '1513'],
	['52', NGC, '1528'],
	['53', NGC, '1535'],
	['54', NGC, '1545'],
	['55', NGC, '1647'],
	['56', NGC, '1664'],
	['57', NGC, '1788'],
	['58', NGC, '1817'],
	['59', NGC, '1857'],
	['60', NGC, '1907'],
	['61', NGC, '1931'],
	['62', NGC, '1961'],
	['63', NGC, '1964'],
	['64', NGC, '1980'],
	['65', NGC, '1999'],
	['66', NGC, '2022'],
	['67', NGC, '2024'],
	['68', NGC, '2126'],
	['69', NGC, '2129'],
	['70', NGC, '2158'],
	['71', NGC, '2169'],
	['72', NGC, '2185'],
	['73', NGC, '2186'],
	['74', NGC, '2194'],
	['75', NGC, '2204'],
	['76', NGC, '2215'],
	['77', NGC, '2232'],
	['78', NGC, '2244'],
	['79', NGC, '2251'],
	['80', NGC, '2264'],
	['81', NGC, '2266'],
	['82', NGC, '2281'],
	['83', NGC, '2286'],
	['84', NGC, '2301'],
	['85', NGC, '2304'],
	['86', NGC, '2311'],
	['87', NGC, '2324'],
	['88', NGC, '2335'],
	['89', NGC, '2343'],
	['90', NGC, '2353'],
	['91', NGC, '2354'],
	['92', NGC, '2355'],
	['93', NGC, '2360'],
	['94', NGC, '2362'],
	['95', NGC, '2371'],
	['96', NGC, '2372'],
	['97', NGC, '2392'],
	['98', NGC, '2395'],
	['99', NGC, '2403'],
	['100', NGC, '2419'],
	['101', NGC, '2420'],
	['102', NGC, '2421'],
	['103', NGC, '2422'],
	['104', NGC, '2423'],
	['105', NGC, '2438'],
	['106', NGC, '2440'],
	['107', NGC, '2479'],
	['108', NGC, '2482'],
	['109', NGC, '2489'],
	['110', NGC, '2506'],
	['111', NGC, '2509'],
	['112', NGC, '2527'],
	['113', NGC, '2539'],
	['114', NGC, '2548'],
	['115', NGC, '2567'],
	['116', NGC, '2571'],
	['117', NGC, '2613'],
	['118', NGC, '2627'],
	['119', NGC, '2655'],
	['120', NGC, '2681'],
	['121', NGC, '2683'],
	['122', NGC, '2742'],
	['123', NGC, '2768'],
	['124', NGC, '2775'],
	['125', NGC, '2782'],
	['126', NGC, '2787'],
	['127', NGC, '2811'],
	['128', NGC, '2841'],
	['129', NGC, '2859'],
	['130', NGC, '2903'],
	['131', NGC, '2950'],
	['132', NGC, '2964'],
	['133', NGC, '2974'],
	['134', NGC, '2976'],
	['135', NGC, '2985'],
	['136', NGC, '3034'],
	['137', NGC, '3077'],
	['138', NGC, '3079'],
	['139', NGC, '3115'],
	['140', NGC, '3147'],
	['141', NGC, '3166'],
	['142', NGC, '3169'],
	['143', NGC, '3184'],
	['144', NGC, '3190'],
	['145', NGC, '3193'],
	['146', NGC, '3198'],
	['147', NGC, '3226'],
	['148', NGC, '3227'],
	['149', NGC, '3242'],
	['150', NGC, '3245'],
	['151', NGC, '3277'],
	['152', NGC, '3294'],
	['153', NGC, '3310'],
	['154', NGC, '3344'],
	['155', NGC, '3377'],
	['156', NGC, '3379'],
	['157', NGC, '3384'],
	['158', NGC, '3395'],
	['159', NGC, '3412'],
	['160', NGC, '3414'],
	['161', NGC, '3432'],
	['162', NGC, '3486'],
	['163', NGC, '3489'],
	['164', NGC, '3504'],
	['165', NGC, '3521'],
	['166', NGC, '3556'],
	['167', NGC, '3593'],
	['168', NGC, '3607'],
	['169', NGC, '3608'],
	['170', NGC, '3610'],
	['171', NGC, '3613'],
	['172', NGC, '3619'],
	['173', NGC, '3621'],
	['174', NGC, '3626'],
	['175', NGC, '3628'],
	['176', NGC, '3631'],
	['177', NGC, '3640'],
	['178', NGC, '3655'],
	['179', NGC, '3665'],
	['180', NGC, '3675'],
	['181', NGC, '3686'],
	['182', NGC, '3726'],
	['183', NGC, '3729'],
	['184', NGC, '3810'],
	['185', NGC, '3813'],
	['186', NGC, '3877'],
	['187', NGC, '3893'],
	['188', NGC, '3898'],
	['189', NGC, '3900'],
	['190', NGC, '3912'],
	['191', NGC, '3912'],
	['192', NGC, '3941'],
	['193', NGC, '3945'],
	['194', NGC, '3949'],
	['195', NGC, '3953'],
	['196', NGC, '3962'],
	['197', NGC, '3982'],
	['198', NGC, '3992'],
	['199', NGC, '3998'],
	['200', NGC, '4026'],
	['201', NGC, '4027'],
	['202', NGC, '4030'],
	['203', NGC, '4036'],
	['204', NGC, '4038'],
	['204', NGC, '4039'],
	['205', NGC, '4041'],
	['206', NGC, '4051'],
	['207', NGC, '4085'],
	['208', NGC, '4088'],
	['209', NGC, '4102'],
	['210', NGC, '4111'],
	['211', NGC, '4143'],
	['212', NGC, '4147'],
	['213', NGC, '4150'],
	['214', NGC, '4151'],
	['215', NGC, '4179'],
	['216', NGC, '4203'],
	['217', NGC, '4214'],
	['218', NGC, '4216'],
	['219', NGC, '4245'],
	['220', NGC, '4251'],
	['221', NGC, '4258'],
	['222', NGC, '4261'],
	['223', NGC, '4273'],
	['224', NGC, '4274'],
	['225', NGC, '4278'],
	['226', NGC, '4281'],
	['227', NGC, '4293'],
	['228', NGC, '4303'],
	['229', NGC, '4314'],
	['230', NGC, '4346'],
	['231', NGC, '4350'],
	['232', NGC, '4361'],
	['233', NGC, '4365'],
	['234', NGC, '4371'],
	['235', NGC, '4394'],
	['236', NGC, '4414'],
	['237', NGC, '4419'],
	['238', NGC, '4429'],
	['239', NGC, '4435'],
	['240', NGC, '4438'],
	['241', NGC, '4442'],
	['242', NGC, '4448'],
	['243', NGC, '4449'],
	['244', NGC, '4450'],
	['245', NGC, '4459'],
	['246', NGC, '4473'],
	['247', NGC, '4477'],
	['248', NGC, '4478'],
	['249', NGC, '4485'],
	['250', NGC, '4490'],
	['251', NGC, '4494'],
	['252', NGC, '4526'],
	['253', NGC, '4527'],
	['254', NGC, '4535'],
	['255', NGC, '4536'],
	['256', NGC, '4546'],
	['257', NGC, '4548'],
	['258', NGC, '4550'],
	['259', NGC, '4559'],
	['260', NGC, '4565'],
	['261', NGC, '4570'],
	['262', NGC, '4594'],
	['263', NGC, '4596'],
	['264', NGC, '4618'],
	['265', NGC, '4631'],
	['266', NGC, '4636'],
	['267', NGC, '4643'],
	['268', NGC, '4654'],
	['269', NGC, '4656'],
	['270', NGC, '4660'],
	['271', NGC, '4665'],
	['272', NGC, '4666'],
	['273', NGC, '4689'],
	['274', NGC, '4697'],
	['275', NGC, '4698'],
	['276', NGC, '4669'],
	['277', NGC, '4725'],
	['278', NGC, '4753'],
	['279', NGC, '4754'],
	['280', NGC, '4762'],
	['281', NGC, '4781'],
	['282', NGC, '4800'],
	['283', NGC, '4845'],
	['284', NGC, '4856'],
	['285', NGC, '4866'],
	['286', NGC, '4900'],
	['287', NGC, '4958'],
	['288', NGC, '4995'],
	['289', NGC, '5005'],
	['290', NGC, '5033'],
	['291', NGC, '5054'],
	['292', NGC, '5195'],
	['293', NGC, '5248'],
	['294', NGC, '5273'],
	['295', NGC, '5322'],
	['296', NGC, '5363'],
	['297', NGC, '5364'],
	['298', NGC, '5466'],
	['299', NGC, '5473'],
	['300', NGC, '5474'],
	['301', NGC, '5557'],
	['302', NGC, '5566'],
	['303', NGC, '5576'],
	['304', NGC, '5631'],
	['305', NGC, '5634'],
	['306', NGC, '5676'],
	['307', NGC, '5689'],
	['308', NGC, '5694'],
	['309', NGC, '5746'],
	['310', NGC, '5846'],
	['311', NGC, '5866'],
	['312', NGC, '5897'],
	['313', NGC, '5907'],
	['314', NGC, '5982'],
	['315', NGC, '6118'],
	['316', NGC, '6144'],
	['317', NGC, '6171'],
	['318', NGC, '6207'],
	['319', NGC, '6217'],
	['320', NGC, '6229'],
	['321', NGC, '6235'],
	['322', NGC, '6284'],
	['323', NGC, '6287'],
	['324', NGC, '6293'],
	['325', NGC, '6304'],
	['326', NGC, '6316'],
	['327', NGC, '6342'],
	['328', NGC, '6355'],
	['329', NGC, '6356'],
	['330', NGC, '6369'],
	['331', NGC, '6401'],
	['332', NGC, '6426'],
	['333', NGC, '6440'],
	['334', NGC, '6445'],
	['335', NGC, '6451'],
	['336', NGC, '6514'],
	['337', NGC, '6517'],
	['338', NGC, '6520'],
	['339', NGC, '6522'],
	['340', NGC, '6528'],
	['341', NGC, '6540'],
	['342', NGC, '6543'],
	['343', NGC, '6544'],
	['344', NGC, '6553'],
	['345', NGC, '6568'],
	['346', NGC, '6569'],
	['347', NGC, '6583'],
	['348', NGC, '6624'],
	['349', NGC, '6629'],
	['350', NGC, '6633'],
	['351', NGC, '6638'],
	['352', NGC, '6642'],
	['353', NGC, '6645'],
	['354', NGC, '6664'],
	['355', NGC, '6712'],
	['356', NGC, '6755'],
	['357', NGC, '6756'],
	['358', NGC, '6781'],
	['359', NGC, '6802'],
	['360', NGC, '6818'],
	['361', NGC, '6823'],
	['362', NGC, '6826'],
	['363', NGC, '6830'],
	['364', NGC, '6834'],
	['365', NGC, '6866'],
	['366', NGC, '6882'],
	['367', NGC, '6885'],
	['368', NGC, '6905'],
	['369', NGC, '6910'],
	['370', NGC, '6934'],
	['371', NGC, '6939'],
	['372', NGC, '6940'],
	['373', NGC, '6946'],
	['374', NGC, '7000'],
	['375', NGC, '7006'],
	['376', NGC, '7008'],
	['377', NGC, '7009'],
	['378', NGC, '7044'],
	['379', NGC, '7062'],
	['380', NGC, '7086'],
	['381', NGC, '7128'],
	['382', NGC, '7142'],
	['383', NGC, '7160'],
	['384', NGC, '7209'],
	['385', NGC, '7217'],
	['386', NGC, '7243'],
	['387', NGC, '7296'],
	['388', NGC, '7331'],
	['389', NGC, '7380'],
	['390', NGC, '7448'],
	['391', NGC, '7479'],
	['392', NGC, '7510'],
	['393', NGC, '7606'],
	['394', NGC, '7662'],
	['395', NGC, '7686'],
	['396', NGC, '7723'],
	['397', NGC, '7727'],
	['398', NGC, '7789'],
	['399', NGC, '7790'],
	['400', NGC, '7814'],
]

// Gum catalog entries as [Gum number, catalog code, designation]: https://en.wikipedia.org/wiki/Gum_catalog
const GUM_CATALOG: [string, number, string][] = [
	['4', NGC, '2359'],
	['15', RCW, '32'],
	['20', RCW, '36'],
	['29', RCW, '49'],
	['60', NGC, '6302'],
	['64', NGC, '6334'],
	['66', NGC, '6357'],
	['72', M, '8'],
	['76', NGC, '6514'],
	['81', M, '17'],
	['83', M, '16'],
]

// Directory of the database and of the downloaded source files.
const DATA_DIR = join(import.meta.dir, '../../api/data')

// Source files and the URL each one is downloaded from when missing.
const SOURCE_FILES = {
	'hyg_v42.csv': 'https://github.com/tiagohm/nebulosa.data/raw/refs/heads/main/hyg_v42.csv',
	'catalog.dat': 'https://github.com/tiagohm/nebulosa.data/raw/refs/heads/main/catalog.dat',
	'names.dat': 'https://github.com/tiagohm/nebulosa.data/raw/refs/heads/main/names.dat',
} as const

// Returns the path of a file inside the data directory.
function dataFile(name: string) {
	return join(DATA_DIR, name)
}

const OUTPUT = dataFile('sky.catalog.db')
const TEMPORARY = dataFile('sky.catalog.db.tmp')

if (!process.argv.includes('--force') && (await Bun.file(OUTPUT).exists())) {
	console.info('sky.catalog.db already exists! Use --force to regenerate it.')
	exit(0)
}

for (const [name, url] of Object.entries(SOURCE_FILES)) {
	const file = Bun.file(dataFile(name))
	if (await file.exists()) continue

	console.info(`downloading ${name}...`)
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
	await Bun.write(file, await response.blob())
}

await fs.rm(TEMPORARY, { force: true })

const db = new Database(TEMPORARY)

createSkyCatalogSchema(db)

// Object row being inserted; angles are radians (J2000), distance AU, velocity AU/day.
interface ObjectInput {
	// Object id (see SkyCatalogObjectRow.id).
	readonly id: number
	// Stellarium object type.
	readonly type: StellariumObjectType
	// Right ascension in radians.
	readonly rightAscension: Angle
	// Declination in radians.
	readonly declination: Angle
	// Visual magnitude; undefined or 99 when unknown.
	readonly magnitude?: number
	// B-V color index in magnitudes.
	readonly bv?: number
	// Proper motion dα/dt in radians per Julian year.
	readonly pmRA?: Angle
	// Proper motion in declination in radians per Julian year.
	readonly pmDEC?: Angle
	// Distance in AU; 0 when unknown.
	readonly distance?: Distance
	// Radial velocity in AU per day.
	readonly rv?: Velocity
	// Spectral or morphological type.
	readonly classification?: string
	// Constellation; computed from the position when absent.
	readonly constellation?: Constellation
	// Major axis in radians; 0 when unknown.
	readonly majorAxis?: Angle
	// Minor axis in radians.
	readonly minorAxis?: Angle
	// Position angle of the major axis in radians.
	readonly orientation?: Angle
}

const insertObject = db.prepare('INSERT OR IGNORE INTO objects (id, type, rightAscension, declination, magnitude, bv, pmRA, pmDEC, distance, rv, constellation, classification, majorAxis, minorAxis, orientation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
const insertName = db.prepare('INSERT OR IGNORE INTO names (objectId, type, name) VALUES (?, ?, ?)')
const selectByName = db.prepare<{ objectId: number }, [number, string]>('SELECT objectId FROM names WHERE type = ? AND name = ?')

// Whether a Stellarium type carries a spectral type (stars and stellar-like sources) rather than a
// morphological one.
function isStellarType(type: StellariumObjectType) {
	return (type >= 1 && type <= 4) || (type >= 21 && type <= 23) || type === StellariumObjectType.STAR || type === StellariumObjectType.CLUSTER_OF_GALAXIES
}

// Keeps a spectral or morphological type only when it is meaningful for the object type; Stellarium
// fills placeholders such as "-" or numeric codes.
function classificationOf(type: StellariumObjectType, value?: string) {
	return value && value[0] !== '-' && isStellarType(type) && Number.isNaN(+value[0]) ? value : null
}

// Returns a positive finite value, or null when unknown.
function positiveOrNull(value?: number) {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : null
}

// Inserts an object, keeping the first row when the id already exists.
function addObject(o: ObjectInput) {
	const majorAxis = positiveOrNull(o.majorAxis)
	const magnitude = o.magnitude !== undefined && Number.isFinite(o.magnitude) && o.magnitude < 99 ? +o.magnitude.toFixed(2) : null
	const cnst = CONSTELLATION_LIST.indexOf(o.constellation ?? constellation(o.rightAscension, o.declination))
	const minorAxis = majorAxis === null ? null : positiveOrNull(o.minorAxis)
	const orientation = majorAxis === null ? null : (o.orientation ?? null)
	insertObject.run(o.id, o.type, o.rightAscension, o.declination, magnitude, o.bv ?? null, o.pmRA ?? 0, o.pmDEC ?? 0, positiveOrNull(o.distance), o.rv || 0, cnst, classificationOf(o.type, o.classification), majorAxis, minorAxis, orientation)
}

// Inserts a designation of an object.
function addName(objectId: number, type: number, name: string) {
	insertName.run(objectId, type, name)
}

// Groups cross-catalog entries by the catalog code of the object they point to, as [designation,
// cross-catalog number] pairs.
function mapCatalog(catalog: readonly [string, number, string][]) {
	const map = new Map<number, [string, string][]>()

	for (const [name, type, id] of catalog) {
		const names = map.get(type) ?? []
		names.push([id, name])
		map.set(type, names)
	}

	return map
}

const BENNETT_CATALOG_MAP = mapCatalog(BENNETT_CATALOG)
const DUNLOP_CATALOG_MAP = mapCatalog(DUNLOP_CATALOG)
const HERSCHEL_CATALOG_MAP = mapCatalog(HERSCHEL_CATALOG)
const GUM_CATALOG_MAP = mapCatalog(GUM_CATALOG)

// Proper names of names.dat by catalog code, as [designation, proper name] pairs.
const NAMES = new Map<number, [string, string][]>()

for await (const entry of readNamesDat(fileHandleSource(await fs.open(dataFile('names.dat'))))) {
	const type: number = CATALOG[entry.prefix as keyof typeof CATALOG] ?? -1
	const names = NAMES.get(type) ?? []
	names.push([entry.id, abbreviateGreekLetter(entry.name)])
	NAMES.set(type, names)
}

NAMES.get(IC)!.push(['342', 'Hidden Galaxy'])
NAMES.get(NGC)!.push(['6752', 'Great Peacock Globular'])

// Adds the designation of an object in a catalog, plus the proper names and cross-catalog numbers known
// for that designation. useIt false adds only the related names (catalogs too large to index). Returns
// whether any name was added.
function addNameFromTypeAndId(objectId: number, type: number, id: string, useIt: boolean = true) {
	const names = NAMES.get(type)?.filter((entry) => entry[0] === id)
	if (names) for (const e of names) addName(objectId, NAME, e[1])

	const ben = BENNETT_CATALOG_MAP.get(type)?.filter((e) => e[0] === id)
	if (ben) for (const e of ben) addName(objectId, BENNETT, e[1])

	const dun = DUNLOP_CATALOG_MAP.get(type)?.filter((e) => e[0] === id)
	if (dun) for (const e of dun) addName(objectId, DUNLOP, e[1])

	const her = HERSCHEL_CATALOG_MAP.get(type)?.filter((e) => e[0] === id)
	if (her) for (const e of her) addName(objectId, HERSCHEL, e[1])

	const gum = GUM_CATALOG_MAP.get(type)?.filter((e) => e[0] === id)
	if (gum) for (const e of gum) addName(objectId, GUM, e[1])

	if (type >= 0 && useIt) {
		addName(objectId, type, id)
		return true
	}

	return !!names?.length || !!ben?.length || !!dun?.length || !!her?.length || !!gum?.length
}

// Adds every HYG star up to STAR_MAGNITUDE_LIMIT, except the Sun.
async function readStarsFromHyg() {
	let count = 0

	for await (const row of readHygCatalog(fileHandleSource(await fs.open(dataFile('hyg_v42.csv'))))) {
		const { id, rightAscension, declination, magnitude, bv, pmRA, pmDEC, distance, rv, constellation, hd, hip, hr, bayer, flamsteed, name, spType } = row

		if (id === 0 || magnitude > STAR_MAGNITUDE_LIMIT) continue

		if (name) addName(id, NAME, name)
		if (bayer) addName(id, BAYER, bayer)
		if (flamsteed) addName(id, FLAMSTEED, flamsteed.toFixed(0))
		if (hd) addName(id, HD, hd.toFixed(0))
		if (hip) addName(id, HIP, hip.toFixed(0))
		if (hr) addName(id, HR, hr.toFixed(0))

		addObject({ id, type: StellariumObjectType.STAR, rightAscension, declination, magnitude, bv, pmRA, pmDEC, distance, rv, classification: spType, constellation })
		count++
	}

	console.info(`added ${count} stars`)
}

// Adds every Stellarium deep-sky object with at least one indexed designation.
async function readDsosFromStellarium() {
	let count = 0

	for await (const entry of readCatalogDat(fileHandleSource(await fs.open(dataFile('catalog.dat'))))) {
		const { type, rightAscension, declination, distance, magnitude, majorAxis, minorAxis, orientation } = entry

		if (type === StellariumObjectType.UNKNOWN) {
			console.warn(`skipping unknown object: ${entry.id}`)
			continue
		}

		const id = entry.id + STELLARIUM_ID_OFFSET

		let add = addNameFromTypeAndId(id, -1, id.toFixed(0))

		if (entry.ngc) add = addNameFromTypeAndId(id, NGC, entry.ngc.toFixed(0)) || add
		if (entry.ic) add = addNameFromTypeAndId(id, IC, entry.ic.toFixed(0)) || add
		if (entry.m) add = addNameFromTypeAndId(id, M, entry.m.toFixed(0)) || add
		if (entry.c) add = addNameFromTypeAndId(id, C, entry.c.toFixed(0)) || add
		if (entry.b) add = addNameFromTypeAndId(id, B, entry.b.toFixed(0)) || add
		if (entry.sh2) add = addNameFromTypeAndId(id, SH2, entry.sh2.toFixed(0)) || add
		if (entry.vdb) add = addNameFromTypeAndId(id, VDB, entry.vdb.toFixed(0)) || add
		if (entry.rcw) add = addNameFromTypeAndId(id, RCW, entry.rcw.toFixed(0)) || add
		if (entry.ldn) add = addNameFromTypeAndId(id, LDN, entry.ldn.toFixed(0)) || add
		if (entry.lbn) add = addNameFromTypeAndId(id, LBN, entry.lbn.toFixed(0)) || add
		if (entry.cr) add = addNameFromTypeAndId(id, CR, entry.cr.toFixed(0)) || add
		if (entry.mel) add = addNameFromTypeAndId(id, MEL, entry.mel.toFixed(0)) || add
		if (entry.pgc) add = addNameFromTypeAndId(id, PGC, entry.pgc.toFixed(0)) || add
		if (entry.ugc) add = addNameFromTypeAndId(id, UGC, entry.ugc.toFixed(0), false) || add
		if (entry.ced) add = addNameFromTypeAndId(id, CED, entry.ced) || add
		if (entry.arp) add = addNameFromTypeAndId(id, ARP, entry.arp.toFixed(0)) || add
		if (entry.vv) add = addNameFromTypeAndId(id, VV, entry.vv.toFixed(0), false) || add
		if (entry.pk) add = addNameFromTypeAndId(id, PK, entry.pk, false) || add
		if (entry.png) add = addNameFromTypeAndId(id, PNG, entry.png, false) || add
		if (entry.snrg) add = addNameFromTypeAndId(id, SNRG, entry.snrg, false) || add
		if (entry.aco) add = addNameFromTypeAndId(id, ACO, entry.aco) || add
		if (entry.eso) add = addNameFromTypeAndId(id, ESO, entry.eso, false) || add
		if (entry.dwb) add = addNameFromTypeAndId(id, DWB, entry.dwb.toFixed(0), false) || add
		if (entry.tr) add = addNameFromTypeAndId(id, TR, entry.tr.toFixed(0)) || add
		if (entry.st) add = addNameFromTypeAndId(id, ST, entry.st.toFixed(0)) || add
		if (entry.ru) add = addNameFromTypeAndId(id, RU, entry.ru.toFixed(0)) || add

		if (add) {
			// The catalog value of dark nebulae is an opacity class, not a magnitude.
			const mag = type === StellariumObjectType.DARK_NEBULA ? undefined : magnitude
			addObject({ id, type, rightAscension, declination, magnitude: mag, distance, classification: entry.mType, majorAxis, minorAxis, orientation })
			count++
		}
	}

	console.info(`added ${count} deep-sky objects`)
}

// SIMBAD query of the star clusters and stellar associations with a "Cl" identifier.
const SIMBAD_STAR_CLUSTER_QUERY = `
select distinct b.oid, b.ra, b.dec, b.otype, b.pmrA, b.pmdEC, b.plx_value, b.rvz_radvel, f.V, f.B, f.J, f.H, ids.ids from basic b
join ident i on b.oid = i.oidref and i.id like 'Cl %'
join ids ids on b.oid = ids.oidref
left join allfluxes f on f.oidref = b.oid
where b.ra is not null and b.dec is not null and (b.otype = 'Cl*..' or b.otype = 'As*..')
order by oid asc
`

// SIMBAD identifier patterns of the cluster catalogs, NGC, and IC.
const CL_REGEX = /Cl\s+([-\w]+)\s+(\d+\w?)/
const NGC_REGEX = /NGC\s+(\d+)/
const IC_REGEX = /IC\s+(\d+)/

// Catalog code of each SIMBAD star cluster catalog name.
const ADDITIONAL_STAR_CLUSTER_CATALOGS: Readonly<Record<string, number>> = {
	Alessi: CATALOG.ALESSI,
	Alicante: CATALOG.ALICANTE,
	Alter: CATALOG.ALTER,
	Antalova: CATALOG.ANTALOVA,
	Apriamaswili: CATALOG.APRIAMASWILI,
	Arp: CATALOG.CL_ARP,
	Barhatova: CATALOG.BARHATOVA,
	Basel: CATALOG.BASEL,
	Berkeley: CATALOG.BERKELEY,
	Bica: CATALOG.BICA,
	Biurakan: CATALOG.BIURAKAN,
	Blanco: CATALOG.BLANCO,
	Bochum: CATALOG.BOCHUM,
	Chupina: CATALOG.CHUPINA,
	Czernik: CATALOG.CZERNIK,
	Danks: CATALOG.DANKS,
	Dias: CATALOG.DIAS,
	Djorg: CATALOG.DJORG,
	'Dolidze-Dzim': CATALOG.DOLIDZE_DZIM,
	Dolidze: CATALOG.DOLIDZE,
	Dufay: CATALOG.DUFAY,
	Feinstein: CATALOG.FEINSTEIN,
	Ferrero: CATALOG.FERRERO,
	Graff: CATALOG.GRAFF,
	Gulliver: CATALOG.GULLIVER,
	Haffner: CATALOG.HAFFNER,
	Harvard: CATALOG.HARVARD,
	'Haute-Provence': CATALOG.HAUTE_PROVENCE,
	Hogg: CATALOG.HOGG,
	Iskurzdajan: CATALOG.ISKURZDAJAN,
	Johansson: CATALOG.JOHANSSON,
	Kharchenko: CATALOG.KHARCHENKO,
	King: CATALOG.KING,
	Kron: CATALOG.KRON,
	Lindsay: CATALOG.LINDSAY,
	Loden: CATALOG.LODEN,
	Lynga: CATALOG.LYNGA,
	Mamajek: CATALOG.MAMAJEK,
	Moffat: CATALOG.MOFFAT,
	Mrk: CATALOG.MRK,
	Pal: CATALOG.PAL,
	Pismis: CATALOG.PISMIS,
	Platais: CATALOG.PLATAIS,
	Roslund: CATALOG.ROSLUND,
	Saurer: CATALOG.SAURER,
	Sher: CATALOG.SHER,
	Skiff: CATALOG.SKIFF,
	Stephenson: CATALOG.STEPHENSON,
	Terzan: CATALOG.TERZAN,
	Tombaugh: CATALOG.TOMBAUGH,
	Turner: CATALOG.TURNER,
	Upgren: CATALOG.UPGREN,
	Waterloo: CATALOG.WATERLOO,
	Westerlund: CATALOG.WESTERLUND,
	Zwicky: CATALOG.ZWICKY,
}

// Adds the SIMBAD star cluster designations: to the matching NGC or IC object when there is one,
// otherwise to a new object keyed by the SIMBAD oid.
async function readStarClustersFromSimbad() {
	const rows = await simbadQuery(SIMBAD_STAR_CLUSTER_QUERY)
	if (!rows) throw new Error('SIMBAD star cluster query failed')

	let count = 0

	for (const item of rows) {
		const identifiers = item[12]
			.split('|')
			.map((e) => CL_REGEX.exec(e) ?? NGC_REGEX.exec(e) ?? IC_REGEX.exec(e))
			.filter((e) => !!e)
		const cl = identifiers.find((e) => e[0].startsWith('Cl'))

		if (!cl) {
			console.warn('invalid star cluster name', item[12])
			continue
		}

		const [, name, clusterId] = cl
		const catalog = ADDITIONAL_STAR_CLUSTER_CATALOGS[name]

		if (catalog === undefined) continue

		const ngc = identifiers.find((e) => e[0].startsWith('NGC'))
		const ic = identifiers.find((e) => e[0].startsWith('IC'))
		let objectId = (ngc && selectByName.get(NGC, ngc[1])?.objectId) || (ic && selectByName.get(IC, ic[1])?.objectId) || 0

		if (!objectId) {
			const ra = deg(+item[1])
			const dec = deg(+item[2])
			const otype = item[3]
			const plx = mas(+item[6])
			const mV = item[8] ? +item[8] : 99
			const mB = item[9] ? +item[9] : 99
			const mJ = item[10] ? +item[10] : 99
			const mH = item[11] ? +item[11] : 99
			const type = otype === 'Opc' ? StellariumObjectType.OPEN_STAR_CLUSTER : otype === 'Cl*' ? StellariumObjectType.STAR_CLUSTER : otype === 'ClC' ? StellariumObjectType.GLOBULAR_STAR_CLUSTER : StellariumObjectType.STELLAR_ASSOCIATION

			objectId = SIMBAD_ID_OFFSET + +item[0]
			// SIMBAD reports μα·cosδ; the catalog stores dα/dt.
			const pmRA = (mas(+item[4]) || 0) / Math.cos(dec)
			addObject({ id: objectId, type, rightAscension: ra, declination: dec, magnitude: mV < 99 ? mV : Math.min(mB, mJ, mH), pmRA, pmDEC: mas(+item[5]) || 0, distance: plx ? 1 / Math.abs(plx) : undefined, rv: kilometerPerSecond(+item[7] || 0) })
			count++
		}

		addName(objectId, catalog, clusterId)
	}

	console.info(`added ${count} star clusters from SIMBAD`)
}

db.run('BEGIN TRANSACTION')

await readStarsFromHyg()
await readDsosFromStellarium()
await readStarClustersFromSimbad()

writeSkyCatalogMeta(db, 'generatedAt', new Date().toISOString())
writeSkyCatalogMeta(db, 'sources', JSON.stringify({ ...SOURCE_FILES, simbad: 'SIMBAD TAP star clusters' }))

db.run('COMMIT')
db.run('VACUUM')

// Statements hold the file open on Windows until finalized, which blocks the rename.
insertObject.finalize()
insertName.finalize()
selectByName.finalize()
db.close(true)

await fs.rename(TEMPORARY, OUTPUT)

console.info(`written ${OUTPUT}`)
