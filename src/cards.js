// M1 sample deck: real titles and years, no ratings yet (those arrive with TMDB + OMDb in M2).
// hue only tints the placeholder poster block.
const deck = [
  ["Inception", 2010, "Movie", "Sci-fi, thriller"],
  ["Breaking Bad", 2008, "TV series", "Crime, drama"],
  ["Spirited Away", 2001, "Anime film", "Fantasy, adventure"],
  ["The Dark Knight", 2008, "Movie", "Action, crime"],
  ["Attack on Titan", 2013, "Anime series", "Action, dark fantasy"],
  ["Parasite", 2019, "Movie", "Thriller, dark comedy"],
  ["The Office", 2005, "TV series", "Comedy"],
  ["Death Note", 2006, "Anime series", "Thriller, mystery"],
  ["Interstellar", 2014, "Movie", "Sci-fi, drama"],
  ["Game of Thrones", 2011, "TV series", "Fantasy, drama"],
  ["Your Name", 2016, "Anime film", "Romance, fantasy"],
  ["Pulp Fiction", 1994, "Movie", "Crime, dark comedy"],
  ["Stranger Things", 2016, "TV series", "Sci-fi, horror"],
  ["Fullmetal Alchemist: Brotherhood", 2009, "Anime series", "Adventure, fantasy"],
  ["The Godfather", 1972, "Movie", "Crime, drama"],
  ["Severance", 2022, "TV series", "Sci-fi, thriller"],
  ["Cowboy Bebop", 1998, "Anime series", "Sci-fi, action"],
  ["Mad Max: Fury Road", 2015, "Movie", "Action, sci-fi"],
  ["The Bear", 2022, "TV series", "Drama, comedy"],
  ["Demon Slayer", 2019, "Anime series", "Action, fantasy"],
];

export const CARDS = deck.map(([title, year, type, genres], i) => ({
  id: `sample-${i + 1}`,
  title,
  year,
  type,
  genres,
  hue: (i * 47) % 360,
}));
