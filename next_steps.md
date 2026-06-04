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

Give me the plan for this feature.  We should really only need to change the front end.  But tell me you best option and ask any quesitons you need to 

Fix some UI issues, ask any questions you have before you start

UI Updates:
- on trip list screen; format the dates to be readable in format "June 1st" for example.
- for the new trip flow, we need to default values
    - date for the outbound flight should default to trip start.  default end of outbound to 11pm start date. 
    - date for the return flight should default to trip end date. default end of return to 11pm end date. 
    - end dates need to be after start dates.
    - all dates need to fall within the trip start and end dates.

    
Break down into components:
- look at the models.py file.  Create sub components for Location, TravelDetails, and StayDetails. These will be included in the larger trip point form
- create trip point form.  
- For now let's expose ui elements based on the endpoint schemas.  
- parent context is going to feed the form the day id and trip id. 