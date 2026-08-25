/**
 * Name pools for generated players.
 *
 * The 48 tier-2 clubs came back from the bundle with empty rosters, so their squads are
 * generated — and generated players need names. These are ordinary regional given/family
 * names combined at random; they are not real players, which keeps generated squads clearly
 * distinct from the recovered tier-1 rosters that do use real names.
 */

import type { LeagueId } from '../types/core'
import type { Rng } from './rng'

export type Region = 'nz' | 'pacific' | 'aus' | 'eng' | 'fra' | 'ire' | 'wal' | 'sco' | 'ita' | 'rsa'

interface NamePool {
  first: readonly string[]
  last: readonly string[]
}

const POOLS: Record<Region, NamePool> = {
  nz: {
    first: ['Tama', 'Reuben', 'Cody', 'Hemi', 'Jarrod', 'Kane', 'Liam', 'Manaia', 'Nikau', 'Ollie',
      'Rangi', 'Shaun', 'Tane', 'Wiremu', 'Zane', 'Braxton', 'Caleb', 'Devon', 'Ethan', 'Fletcher',
      'Hunter', 'Jesse', 'Kobe', 'Lachlan'],
    last: ['Waitoa', 'Rehu', 'Kahu', 'Mataira', 'Ngata', 'Paretai', 'Rawiri', 'Tuhoro', 'Whanau',
      'Ashcroft', 'Beattie', 'Carmichael', 'Donnelly', 'Ellery', 'Fairbrother', 'Gillanders',
      'Hardgrave', 'Iversen', 'Jeffcoat', 'Kirwan', 'Lomax', 'Merrick', 'Nairn', 'Orme'],
  },
  pacific: {
    first: ['Sione', 'Viliami', 'Josua', 'Semi', 'Taniela', 'Filipo', 'Manu', 'Peni', 'Ratu',
      'Sekope', 'Tevita', 'Vuate', 'Apisai', 'Eroni', 'Iosefo', 'Lolani', 'Mesake', 'Nemani',
      'Onisi', 'Penioni', 'Sailosi', 'Tomasi', 'Vereniki', 'Waisake'],
    last: ['Tuilagi', 'Vakatawa', 'Nailolo', 'Raqica', 'Bolatagici', 'Ceceli', 'Delaimatuku',
      'Finau', 'Havili', 'Kunavula', 'Lomani', 'Matavesi', 'Naiqama', 'Ravouvou', 'Saumaki',
      'Tagicakibau', 'Uluinayau', 'Vatubua', 'Waqaniburotu', 'Yalayalatabua', 'Fifita', 'Latu',
      'Piutau', 'Tameifuna'],
  },
  aus: {
    first: ['Angus', 'Brodie', 'Cooper', 'Darcy', 'Flynn', 'Harrison', 'Jackson', 'Kye', 'Lachie',
      'Mitchell', 'Nathan', 'Oscar', 'Patrick', 'Riley', 'Sam', 'Tate', 'Will', 'Xavier', 'Zac',
      'Bailey', 'Callum', 'Declan', 'Ewan', 'Fergus'],
    last: ['Corrigan', 'Blakeney', 'Ashworth', 'Duxbury', 'Eastwood', 'Fairweather', 'Gallagher',
      'Haddock', 'Ingham', 'Jamieson', 'Kenwright', 'Lindsay', 'Mullane', 'Nesbitt', 'Ogilvie',
      'Pemberton', 'Quested', 'Radford', 'Sinclair', 'Thurlow', 'Underwood', 'Vickery',
      'Wakeling', 'Yardley'],
  },
  eng: {
    first: ['Alfie', 'Ben', 'Charlie', 'Dominic', 'Edward', 'Freddie', 'George', 'Henry', 'Isaac',
      'Jack', 'Kieran', 'Louis', 'Max', 'Noah', 'Oliver', 'Peter', 'Reuben', 'Samuel', 'Thomas',
      'Tobias', 'Vincent', 'Wilfred', 'Zachary', 'Rory'],
    last: ['Ashdown', 'Barlow', 'Chadwick', 'Denholm', 'Ellingham', 'Farthing', 'Grantham',
      'Halliwell', 'Ibbotson', 'Jellicoe', 'Kettering', 'Longstaff', 'Marchant', 'Netherwood',
      'Oakley', 'Pilkington', 'Quilter', 'Rothwell', 'Sedgwick', 'Thackeray', 'Ullathorne',
      'Vaughan', 'Waddington', 'Yarwood'],
  },
  fra: {
    first: ['Antoine', 'Baptiste', 'Clément', 'Damien', 'Étienne', 'Florian', 'Gaël', 'Hugo',
      'Julien', 'Kévin', 'Loïc', 'Mathieu', 'Nicolas', 'Olivier', 'Pierre', 'Quentin', 'Romain',
      'Sébastien', 'Thibault', 'Ugo', 'Valentin', 'Yoann', 'Arnaud', 'Bastien'],
    last: ['Barrande', 'Cazenave', 'Duthil', 'Escande', 'Fourcade', 'Guilhem', 'Hourcade',
      'Iribarne', 'Jourdain', 'Laborde', 'Marchand', 'Nadau', 'Oyharçabal', 'Peyrelongue',
      'Quéré', 'Rouffiac', 'Sarthou', 'Tissot', 'Urdiain', 'Vaquier', 'Zabala', 'Bergougnoux',
      'Castagnède', 'Dulin'],
  },
  ire: {
    first: ['Aidan', 'Barry', 'Cian', 'Darragh', 'Eoin', 'Fionn', 'Gearóid', 'Hugh', 'Iarla',
      'Jack', 'Killian', 'Lorcan', 'Micheál', 'Niall', 'Oisín', 'Pádraig', 'Ronan', 'Seán',
      'Tadhg', 'Uinseann', 'Cormac', 'Diarmuid', 'Fergal', 'Rian'],
    last: ['Brannigan', 'Callaghan', 'Devereux', 'Enright', 'Fitzharris', 'Gormley', 'Hanrahan',
      'Kinsella', 'Loughnane', 'Mulcahy', 'Nolan', "O'Dwyer", "O'Halloran", 'Prendergast',
      'Quigley', 'Rafferty', 'Scanlon', 'Treacy', 'Vaughey', 'Whelan', 'Boylan', 'Corrigan',
      'Dempsey', 'Fogarty'],
  },
  wal: {
    first: ['Aled', 'Bleddyn', 'Carwyn', 'Dylan', 'Emyr', 'Gareth', 'Huw', 'Ieuan', 'Llŷr',
      'Morgan', 'Osian', 'Rhys', 'Sion', 'Tomos', 'Wyn', 'Cerith', 'Deian', 'Elis', 'Gruff',
      'Iwan', 'Lewys', 'Meical', 'Owain', 'Steffan'],
    last: ['Bevan', 'Cadwallader', 'Dafydd', 'Emlyn', 'Fychan', 'Gwilym', 'Hopkin', 'Idris',
      'Llewellyn', 'Meredith', 'Newlyn', 'Owens', 'Prosser', 'Rhydderch', 'Selwyn', 'Trahaearn',
      'Vaughan', 'Wynne', 'Ap Rhys', 'Bowen', 'Caradog', 'Dyfed', 'Ellis', 'Griffiths'],
  },
  sco: {
    first: ['Alasdair', 'Blair', 'Callum', 'Dougal', 'Euan', 'Fraser', 'Gregor', 'Hamish', 'Iain',
      'Jamie', 'Kenneth', 'Lachlan', 'Murray', 'Niall', 'Ollie', 'Rory', 'Struan', 'Torquil',
      'Angus', 'Duncan', 'Finlay', 'Grant', 'Magnus', 'Ruaridh'],
    last: ['Arbuckle', 'Balfour', 'Crichton', 'Drummond', 'Elphinstone', 'Fyfe', 'Galbraith',
      'Hutcheon', 'Inverarity', 'Kinnear', 'Lamont', 'MacAulay', 'Nisbet', 'Ogilvy', 'Pentland',
      'Rennie', 'Strachan', 'Tulloch', 'Urquhart', 'Wemyss', 'Buccleuch', 'Cargill', 'Dalgleish',
      'Ferguson'],
  },
  ita: {
    first: ['Alessandro', 'Bernardo', 'Carlo', 'Davide', 'Enrico', 'Federico', 'Giacomo', 'Lorenzo',
      'Marco', 'Nicolò', 'Paolo', 'Riccardo', 'Stefano', 'Tommaso', 'Umberto', 'Vittorio',
      'Andrea', 'Cristian', 'Emanuele', 'Filippo', 'Gianluca', 'Luca', 'Matteo', 'Simone'],
    last: ['Bergamasco', 'Cittadini', 'Dellapè', 'Esposito', 'Favaro', 'Gritti', 'Lucchese',
      'Mastrandrea', 'Nitoglia', 'Ongaro', 'Pratichetti', 'Quartaroli', 'Rizzo', 'Sgarbi',
      'Trevisiol', 'Vosti', 'Zanusso', 'Barbini', 'Canavosio', 'Ferrarini', 'Guadagnini',
      'Lorigiola', 'Meloncelli', 'Perugini'],
  },
  rsa: {
    first: ['Ruan', 'Pieter', 'Johan', 'Willem', 'Dewald', 'Francois', 'Gerhard', 'Hendrik',
      'Jaco', 'Kobus', 'Lukhanyo', 'Marnus', 'Nkosi', 'Ox', 'Rynhardt', 'Sbu', 'Thabo', 'Vincent',
      'Wian', 'Andre', 'Bongi', 'Cheslin', 'Damian', 'Elrigh'],
    last: ['Van Wyk', 'Du Plessis', 'Kriel', 'Nortje', 'Oosthuizen', 'Pretorius', 'Roux',
      'Steenkamp', 'Theunissen', 'Van Rooyen', 'Willemse', 'Zondagh', 'Bezuidenhout', 'Coetzee',
      'De Villiers', 'Engelbrecht', 'Fourie', 'Grobler', 'Hattingh', 'Jantjies', 'Mahlangu',
      'Ndungane', 'Sithole', 'Mtawarira'],
  },
}

/**
 * Where each league recruits from. Weights are rough national make-ups, so a Pro D2 squad
 * reads mostly French with a Pacific Islander or two, and a URC squad spans four unions.
 */
const LEAGUE_REGIONS: Record<LeagueId, [Region, number][]> = {
  super_rugby: [['nz', 50], ['aus', 30], ['pacific', 20]],
  npc: [['nz', 75], ['pacific', 25]],
  shute_shield: [['aus', 80], ['pacific', 20]],
  premiership: [['eng', 74], ['rsa', 6], ['pacific', 6], ['aus', 5], ['nz', 5], ['fra', 4]],
  rfu_championship: [['eng', 88], ['pacific', 7], ['rsa', 5]],
  top_14: [['fra', 64], ['rsa', 10], ['nz', 8], ['pacific', 8], ['aus', 5], ['eng', 5]],
  pro_d2: [['fra', 84], ['pacific', 9], ['rsa', 7]],
  urc: [['ire', 28], ['wal', 24], ['sco', 20], ['rsa', 16], ['ita', 12]],
}

export function regionForLeague(rng: Rng, leagueId: LeagueId): Region {
  const weights = LEAGUE_REGIONS[leagueId]
  return rng.weighted(weights, ([, w]) => w)[0]
}

/**
 * A generated player name. `taken` prevents duplicates inside a squad — a club with two
 * players of the same name reads as a bug even when it is only a coincidence.
 */
export function generateName(rng: Rng, region: Region, taken?: Set<string>): string {
  const pool = POOLS[region]
  for (let attempt = 0; attempt < 40; attempt++) {
    const name = `${rng.pick(pool.first)} ${rng.pick(pool.last)}`
    if (!taken || !taken.has(name)) {
      taken?.add(name)
      return name
    }
  }
  // Pools exhausted for this squad — fall back to an initial so it stays readable.
  const name = `${rng.pick(pool.first)} ${rng.pick(pool.last)}-${rng.pick(pool.last)}`
  taken?.add(name)
  return name
}

/** Exposed for tests that check pool health. */
export const NAME_POOLS = POOLS
export const LEAGUE_REGION_WEIGHTS = LEAGUE_REGIONS
