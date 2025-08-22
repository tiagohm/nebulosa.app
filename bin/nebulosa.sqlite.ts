import { Database } from 'bun:sqlite'
import fs from 'fs/promises'
import { type Angle, deg, mas } from 'nebulosa/src/angle'
import { CONSTELLATION_LIST, type Constellation, constellation } from 'nebulosa/src/constellation'
import type { Distance } from 'nebulosa/src/distance'
import { readHygCatalog } from 'nebulosa/src/hyg'
import { fileHandleSource } from 'nebulosa/src/io'
import { simbadQuery } from 'nebulosa/src/simbad'
import { readCatalogDat, readNamesDat, StellariumObjectType } from 'nebulosa/src/stellarium'
import { kilometerPerSecond, type Velocity } from 'nebulosa/src/velocity'

const NAME = 0
const NGC = 1
const IC = 2
const BAYER = 3 // greek letters
const FLAMSTEED = 4 // ordered numbers
const HD = 5
const HR = 6
const HIP = 7
const M = 8 // Messier
const C = 9 // Caldwell
const B = 10 // Barnard
const SH2 = 11 // Sharpless
const LBN = 12
const LDN = 13
const MEL = 14 // Melotte
const CR = 15 // Collinder
const ARP = 16
const ABELL = 17
const PGC = 18
const TR = 19 // Trumpler
const ST = 20 // Stock
const RU = 21 // Ruprecht
const UGC = 22
const CED = 23
const RCW = 24
const VDB = 25
const VV = 26
const PK = 27
const PNG = 28
const ACO = 29
const ESO = 30
const SNRG = 31
const DWB = 32
const BENNETT = 33
const DUNLOP = 34
const HERSHEL = 35
const GUM = 36
const BOCHUM = 37

const ALESSI = 38
const ALICANTE = 39
const ALTER = 40
const ANTALOVA = 41
const APRIAMASWILI = 42
const CL_ARP = 43
const BARHATOVA = 44
const BASEL = 45
const BERKELEY = 46
const BICA = 47
const BIURAKAN = 48
const BLANCO = 49
const CHUPINA = 50
const CZERNIK = 51
const DANKS = 52
const DIAS = 53
const DJORG = 54
const DOLIDZE_DZIM = 55
const DOLIDZE = 56
const DUFAY = 57
const FEINSTEIN = 58
const FERRERO = 59
const GRAFF = 60
const GULLIVER = 61
const HAFFNER = 62
const HARVARD = 63
const HAUTE_PROVENCE = 64
const HOGG = 65
const ISKURZDAJAN = 66
const JOHANSSON = 67
const KHARCHENKO = 68
const KING = 69
const KRON = 70
const LINDSAY = 71
const LODEN = 72
const LYNGA = 73
const MAMAJEK = 74
const MOFFAT = 75
const MRK = 76
const PAL = 77
const PISMIS = 78
const PLATAIS = 79
const ROSLUND = 80
const SAURER = 81
const SHER = 82
const SKIFF = 83
const STEPHENSON = 84
const TERZAN = 85
const TOMBAUGH = 86
const TURNER = 87
const UPGREN = 88
const WATERLOO = 89
const WESTERLUND = 90
const ZWICKY = 91

const CATALOGS = { NAME, NGC, IC, BAYER, FLAMSTEED, HD, HR, HIP, M, C, B, SH2, LBN, LDN, CR, MEL, ARP, ABELL, PGC, TR, ST, RU, UGC, CED, RCW, VDB, VV, PK, PNG, ACO, ESO, SNRG, DWB, BENNETT, DUNLOP, HERSHEL, GUM, BOCHUM }

// https://www.docdb.net/tutorials/bennett_catalogue.php
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

// https://www.docdb.net/tutorials/dunlop_catalogue.php
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

// https://www.go-astronomy.com/herschel-objects.htm
const HERSHEL_CATALOG: [string, number, string][] = [
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

// https://en.wikipedia.org/wiki/Gum_catalog
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

if (await fs.exists('data/nebulosa.sqlite')) await fs.unlink('data/nebulosa.sqlite')

const db = new Database('data/nebulosa.sqlite')

db.run('PRAGMA journal_mode = WAL;')

db.run('CREATE TABLE IF NOT EXISTS dsos (id INTEGER PRIMARY KEY, type INTEGER, rightAscension REAL, declination REAL, magnitude REAL, pmRa REAL, pmDec REAL, distance INTEGER, rv REAL, constellation INTEGER, spmType TEXT);')
db.run('CREATE TABLE IF NOT EXISTS names (dsoId INTEGER, type INTEGER, name TEXT COLLATE NOCASE, PRIMARY KEY (dsoId, type, name), FOREIGN KEY (dsoId) REFERENCES dsos(id)) WITHOUT ROWID;')

function mapNameWithGreekLetter(name: string) {
	if (name.startsWith('α')) return `Alp ${name.substring(1).trim()}`
	if (name.startsWith('β')) return `Bet ${name.substring(1).trim()}`
	if (name.startsWith('γ')) return `Gam ${name.substring(1).trim()}`
	if (name.startsWith('δ')) return `Del ${name.substring(1).trim()}`
	if (name.startsWith('ε')) return `Eps ${name.substring(1).trim()}`
	if (name.startsWith('ζ')) return `Zet ${name.substring(1).trim()}`
	if (name.startsWith('η')) return `Eta ${name.substring(1).trim()}`
	if (name.startsWith('θ')) return `The ${name.substring(1).trim()}`
	if (name.startsWith('ι')) return `Iot ${name.substring(1).trim()}`
	if (name.startsWith('κ')) return `Kap ${name.substring(1).trim()}`
	if (name.startsWith('λ')) return `Lam ${name.substring(1).trim()}`
	if (name.startsWith('μ')) return `Mu ${name.substring(1).trim()}`
	if (name.startsWith('ν')) return `Nu ${name.substring(1).trim()}`
	if (name.startsWith('ξ')) return `Xi ${name.substring(1).trim()}`
	if (name.startsWith('ο')) return `Omi ${name.substring(1).trim()}`
	if (name.startsWith('π')) return `Pi ${name.substring(1).trim()}`
	if (name.startsWith('ρ')) return `Rho ${name.substring(1).trim()}`
	if (name.startsWith('σ')) return `Sig ${name.substring(1).trim()}`
	if (name.startsWith('τ')) return `Tau ${name.substring(1).trim()}`
	if (name.startsWith('υ')) return `Ups ${name.substring(1).trim()}`
	if (name.startsWith('φ')) return `Phi ${name.substring(1).trim()}`
	if (name.startsWith('χ')) return `Chi ${name.substring(1).trim()}`
	if (name.startsWith('ψ')) return `Psi ${name.substring(1).trim()}`
	if (name.startsWith('ω')) return `Ome ${name.substring(1).trim()}`
	return name
}

function mapCatalog(catalog: typeof BENNETT_CATALOG) {
	return catalog.reduce((map, entry) => {
		const [name, type, id] = entry
		const names = map.get(type) ?? []
		names.push([id, name])
		map.set(type, names)
		return map
	}, new Map<number, [string, string][]>())
}

const BENNETT_CATALOG_MAP = mapCatalog(BENNETT_CATALOG)
const DUNLOP_CATALOG_MAP = mapCatalog(DUNLOP_CATALOG)
const HERSHEL_CATALOG_MAP = mapCatalog(HERSHEL_CATALOG)
const GUM_CATALOG_MAP = mapCatalog(GUM_CATALOG)

const NAMES = new Map<number, [string, string][]>()

for await (const entry of readNamesDat(fileHandleSource(await fs.open('data/names.dat')))) {
	const type = CATALOGS[entry.prefix as never] ?? -1
	const names = NAMES.get(type) ?? []
	names.push([entry.id, mapNameWithGreekLetter(entry.name)])
	NAMES.set(type, names)
}

NAMES.get(IC)!.push(['342', 'Hidden Galaxy'])
NAMES.get(NGC)!.push(['6752', 'Great Peacock Globular'])

function addDso(id: number, type: StellariumObjectType, ra: Angle, dec: Angle, mag: number, pmRa: Angle, pmDec: Angle, distance: Distance, rv: Velocity, spmType?: string | null, cnst?: Constellation) {
	spmType = spmType && spmType[0] !== '-' && ((type >= 1 && type <= 4) || (type >= 21 && type <= 23) || type === 29 || type === 34) && Number.isNaN(+spmType[0]) ? spmType : null
	const data = [id, type, ra, dec, mag.toFixed(2), pmRa, pmDec, Math.abs(distance).toFixed(0), rv, CONSTELLATION_LIST.indexOf(cnst ?? constellation(ra, dec)), spmType]
	return db.run('INSERT OR IGNORE INTO dsos(id, type, rightAscension, declination, magnitude, pmRa, pmDec, distance, rv, constellation, spmType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);', data).lastInsertRowid
}

function addName(dsoId: number | bigint, type: number, name: string) {
	return db.run('INSERT OR IGNORE INTO names(dsoId, type, name) VALUES (?, ?, ?);', [dsoId, type, name]).lastInsertRowid
}

function addNameFromTypeAndId(dsoId: number | bigint, type: number, id: string, useIt: boolean = true) {
	const names = NAMES.get(type)?.filter((entry) => entry[0] === id)
	names?.forEach((e) => addName(dsoId, NAME, e[1]))

	const ben = BENNETT_CATALOG_MAP.get(type)?.filter((e) => e[0] === id)
	ben?.forEach((e) => addName(dsoId, BENNETT, e[1]))

	const dun = DUNLOP_CATALOG_MAP.get(type)?.filter((e) => e[0] === id)
	dun?.forEach((e) => addName(dsoId, DUNLOP, e[1]))

	const her = HERSHEL_CATALOG_MAP.get(type)?.filter((e) => e[0] === id)
	her?.forEach((e) => addName(dsoId, HERSHEL, e[1]))

	const gum = GUM_CATALOG_MAP.get(type)?.filter((e) => e[0] === id)
	gum?.forEach((e) => addName(dsoId, GUM, e[1]))

	if (type >= 0 && useIt) {
		addName(dsoId, type, id)
		return true
	}

	return !!names?.length || !!ben?.length || !!dun?.length || !!her?.length || !!gum?.length
}

async function readDsosFromStellarium() {
	console.time('stellarium')

	for await (const entry of readCatalogDat(fileHandleSource(await fs.open('data/catalog.dat')))) {
		const { type, rightAscension, declination, distance, mB, mV } = entry

		if (type === StellariumObjectType.UNKNOWN) {
			console.warn(`skipping unknown object: ${entry.id}`)
			continue
		}

		const id = 1000000 + entry.id

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
			const magnitude = mV === 99 ? 99 : type === StellariumObjectType.DARK_NEBULA ? 99 - mV : Math.min(mV, mB)
			addDso(id, type, rightAscension, declination, magnitude, 0, 0, distance, 0, entry.mType)
		}
	}

	console.timeEnd('stellarium')
}

async function readStarsFromHyg() {
	console.time('hyg')

	for await (const row of readHygCatalog(fileHandleSource(await fs.open('data/hyg_v42.csv')))) {
		const { id, rightAscension, declination, magnitude, pmRa, pmDec, distance, rv, constellation, hd, hip, hr, bayer, flamsteed, name, spType } = row

		if (id > 0 && magnitude <= 7 && (bayer || flamsteed || name)) {
			if (name) addName(id, NAME, name)
			if (bayer) addName(id, BAYER, bayer)
			if (flamsteed) addName(id, FLAMSTEED, flamsteed.toFixed(0))
			if (hd) addName(id, HD, hd.toFixed(0))
			if (hip) addName(id, HIP, hip.toFixed(0))
			if (hr) addName(id, HR, hr.toFixed(0))

			addDso(id, StellariumObjectType.STAR, rightAscension, declination, magnitude, pmRa, pmDec, distance, rv, spType, constellation)
		}
	}

	console.timeEnd('hyg')
}

await readStarsFromHyg()
await readDsosFromStellarium()

const SIMBAD_STAR_CLUSTER_QUERY = `
select distinct b.oid, b.ra, b.dec, b.otype, b.pmra, b.pmdec, b.plx_value, b.rvz_radvel, f.V, f.B, f.J, f.H, ids.ids from basic b
join ident i on b.oid = i.oidref and i.id like 'Cl %'
join ids ids on b.oid = ids.oidref
left join allfluxes f on f.oidref = b.oid
where b.ra is not null and b.dec is not null and (b.otype = 'Cl*..' or b.otype = 'As*..')
order by oid asc
`

const CL_REGEX = /Cl\s+([-\w]+)\s+(\d+\w?)/
const NGC_REGEX = /NGC\s+(\d+)/
const IC_REGEX = /IC\s+(\d+)/

const ADDITIONAL_STAR_CLUSTER_CATALOGS: Record<string, number> = {
	Alessi: ALESSI,
	Alicante: ALICANTE,
	Alter: ALTER,
	Antalova: ANTALOVA,
	Apriamaswili: APRIAMASWILI,
	Arp: CL_ARP,
	Barhatova: BARHATOVA,
	Basel: BASEL,
	Berkeley: BERKELEY,
	Bica: BICA,
	Biurakan: BIURAKAN,
	Blanco: BLANCO,
	Bochum: BOCHUM,
	Chupina: CHUPINA,
	Czernik: CZERNIK,
	Danks: DANKS,
	Dias: DIAS,
	Djorg: DJORG,
	'Dolidze-Dzim': DOLIDZE_DZIM,
	Dolidze: DOLIDZE,
	Dufay: DUFAY,
	Feinstein: FEINSTEIN,
	Ferrero: FERRERO,
	Graff: GRAFF,
	Gulliver: GULLIVER,
	Haffner: HAFFNER,
	Harvard: HARVARD,
	'Haute-Provence': HAUTE_PROVENCE,
	Hogg: HOGG,
	Iskurzdajan: ISKURZDAJAN,
	Johansson: JOHANSSON,
	Kharchenko: KHARCHENKO,
	King: KING,
	Kron: KRON,
	Lindsay: LINDSAY,
	Loden: LODEN,
	Lynga: LYNGA,
	Mamajek: MAMAJEK,
	Moffat: MOFFAT,
	Mrk: MRK,
	Pal: PAL,
	Pismis: PISMIS,
	Platais: PLATAIS,
	Roslund: ROSLUND,
	Saurer: SAURER,
	Sher: SHER,
	Skiff: SKIFF,
	Stephenson: STEPHENSON,
	Terzan: TERZAN,
	Tombaugh: TOMBAUGH,
	Turner: TURNER,
	Upgren: UPGREN,
	Waterloo: WATERLOO,
	Westerlund: WESTERLUND,
	Zwicky: ZWICKY,
}

let c = 0

for (const item of (await simbadQuery(SIMBAD_STAR_CLUSTER_QUERY))!) {
	const identifiers = item[12]
		.split('|')
		.map((e) => CL_REGEX.exec(e) ?? NGC_REGEX.exec(e) ?? IC_REGEX.exec(e))
		.filter((e) => !!e)
	const cl = identifiers.filter((e) => e[0].startsWith('Cl'))?.[0]

	if (!cl) {
		console.warn('invalid star cluster name', item[12])
		continue
	}

	const [, name, id] = cl

	if (!(name in ADDITIONAL_STAR_CLUSTER_CATALOGS)) continue

	let dsoId = 0
	const ngc = identifiers.filter((e) => e[0].startsWith('NGC'))?.[0]
	const ic = identifiers.filter((e) => e[0].startsWith('IC'))?.[0]

	if (ngc && ngc.length > 1) {
		const row = db.query<{ dsoId: number }, []>(`SELECT n.dsoId FROM names n WHERE n.type = 1 and n.name = '${ngc[1]}'`).get()
		dsoId = row?.dsoId ?? 0
		if (!dsoId) console.info('NGC', ngc[1], dsoId, item[12])
	}
	if (!dsoId && ic && ic.length > 1) {
		const row = db.query<{ dsoId: number }, []>(`SELECT n.dsoId FROM names n WHERE n.type = 2 and n.name = '${ic[1]}'`).get()
		dsoId = row?.dsoId ?? 0
		if (!dsoId) console.info('IC', ic[1], dsoId, item[12])
	}

	const ra = deg(+item[1])
	const dec = deg(+item[2])
	const otype = item[3]
	const pmRa = mas(+item[4]) / Math.cos(dec)
	const pmDec = mas(+item[5])
	const plx = mas(+item[6])
	const distance = plx ? 1 / Math.abs(plx) : 0
	const rv = kilometerPerSecond(+item[7])
	const mV = item[8] ? +item[8] : 99
	const mB = item[9] ? +item[9] : 99
	const mJ = item[10] ? +item[10] : 99
	const mH = item[11] ? +item[11] : 99
	const mag = mV < 99 ? mV : Math.min(mB, mJ, mH)
	const type = otype === 'Opc' ? StellariumObjectType.OPEN_STAR_CLUSTER : otype === 'Cl*' ? StellariumObjectType.STAR_CLUSTER : otype === 'ClC' ? StellariumObjectType.GLOBULAR_STAR_CLUSTER : StellariumObjectType.STELLAR_ASSOCIATION

	if (dsoId) {
		// Update existing DSO?
	} else {
		dsoId = 2000000 + c
		addDso(dsoId, type, ra, dec, mag, pmRa, pmDec, distance, rv)
		c++
	}

	addName(dsoId, ADDITIONAL_STAR_CLUSTER_CATALOGS[name], id)
}

// db.run('CREATE INDEX IF NOT EXISTS idx_dsos_type ON dsos(type);')
// db.run('CREATE INDEX IF NOT EXISTS idx_dsos_magnitude ON dsos(magnitude);')
// db.run('CREATE INDEX IF NOT EXISTS idx_dsos_constellation ON dsos(constellation);')
// db.run('CREATE INDEX IF NOT EXISTS idx_names_type_name ON names(type, name);')

db.run('VACUUM;')
