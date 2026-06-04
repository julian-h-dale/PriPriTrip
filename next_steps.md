We are going to build out the feature for adding a new trip

Basic rules:
- always follow best patterns and newest standards for react and python fast api.
- ui views need to mobile optimized.  Use the established patterns as much as possible. Always favor using material ui components where possible.

- new trip button available at the top right of the trip list
- clicking it takes user to "carousel" of card elements
    - first card: Trip name, start date, end date
    - second card: Travel (first leg of the trip ie the first flight)
    - third card: return travel (final leg)
- after filling out the form in the carouself of cards, make a request to create a new trip
    - initial trip state should have days nodes for each day between and including the start and end date. initial title can just be the day in format "May 12th"
    - make a travel point for the departing and returning travel. 

- after the succesful post call to create the trip, navigate the user to the that trip view. 